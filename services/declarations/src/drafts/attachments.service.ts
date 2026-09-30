import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, type PersonContext, withPerson } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../clock.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import {
  type CleanUpload,
  DECLARATION_ATTACHMENT_PURPOSE,
  DocumentsClient,
  DocumentsUnavailable,
  UploadNotClean,
  UploadNotFound,
} from '../documents/documents-client.js';
import { UUID } from '../guards.js';
import { personOf } from './access.js';
import { attachmentFileName, hasItem, withAttachment, withoutAttachment } from './attachments.js';
import { declarationAttachmentLinked, declarationAttachmentUnlinked } from './events.js';
import {
  declarationNotDraft,
  sectionArchived,
  validationProblem,
  violatedUniqueConstraint,
} from './problems.js';
import {
  type DeclarationRow,
  liveDeclaration,
  sectionIs,
  type SectionRow,
  storeSection,
} from './repository.js';
import { attachmentLinkSchema, type DeclarationAttachment } from './representation.js';
import { declarationAttachments, declarationSections, isEditable } from './schema.js';
import { SectionCipher } from './section-cipher.js';
import { isStatementKey, type SectionContents, type StatementKey } from './sections.js';

type AttachmentRow = typeof declarationAttachments.$inferSelect;

/**
 * Attachments on a draft's statement items (spec 05). The bytes stay in the documents service:
 * linking verifies through its internal API that the upload is the Commission's, clean and
 * uploaded as a declaration attachment, then in one transaction stores the row (hash and size),
 * adds the reference (with the file name, which stays encrypted) to the item inside the section
 * and bumps the draft version, and only then records the link in documents (so the orphan sweep
 * keeps it). Unlinking removes both; the object is left to documents' orphan sweep. Declarant
 * only, under person row-level security; each change is an event with identifiers only.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly documents: DocumentsClient,
    private readonly sections: SectionCipher,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * Links a clean upload to an item: 404 when the draft or the item is not the caller's, 409 when
   * the draft is not editable or the upload cannot be linked (unknown or another Commission's,
   * not clean, another purpose, linked already), 503 when documents does not answer.
   */
  async link(
    principal: Principal,
    declarationId: string,
    body: unknown,
  ): Promise<{ attachment: DeclarationAttachment; draftVersion: number }> {
    const person = personOf(principal);
    const parsed = attachmentLinkSchema.safeParse(body);
    if (!parsed.success) {
      throw validationProblem(
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      );
    }
    const { itemId, uploadId } = parsed.data;
    // Only a statement's items take attachments.
    const sectionKey = isStatementKey(parsed.data.sectionKey)
      ? parsed.data.sectionKey
      : notFoundIfInvisible<StatementKey>(null);

    // Check the item before asking documents, so a wrong item costs no call.
    const current = notFoundIfInvisible(
      await withPerson(this.db, person, (tx) =>
        editableSection(tx, declarationId, sectionKey, { lock: false }),
      ),
    );
    const tenant = current.declaration.tenant;
    const contents = await this.sections.open(tenant, current.section);
    if (!hasItem(contents, itemId)) notFoundIfInvisible(null);

    const upload = await this.verified(tenant, uploadId);

    const fileName = attachmentFileName(upload.fileName);
    const attachment: AttachmentRow = {
      id: uuidv7(),
      declarationId,
      sectionKey,
      itemId,
      uploadId,
      sha256: upload.sha256,
      size: upload.size,
      linkedAt: this.clock.now(),
    };
    let saved: { draftVersion: number; contents: SectionContents };
    try {
      saved = await withPerson(this.db, person, async (tx) => {
        const { declaration, section } = notFoundIfInvisible(
          await editableSection(tx, declarationId, sectionKey, { lock: true }),
        );
        const stored = await this.sections.open(tenant, section);
        // Null when a save removed the item since it was checked.
        const changed = notFoundIfInvisible(
          withAttachment(stored, itemId, {
            attachmentId: attachment.id,
            uploadId,
            fileName,
            sha256: attachment.sha256,
          }),
        );
        await tx.insert(declarationAttachments).values(attachment);
        const draftVersion = await this.store(tx, declaration, sectionKey, changed);
        await this.events.record(
          tx,
          declarationAttachmentLinked(tenant, { declarationId, uploadId }),
        );
        return { draftVersion, contents: changed };
      });
    } catch (error) {
      if (violatedUniqueConstraint(error) !== 'declaration_attachments_upload_id_key') throw error;
      throw new ProblemException({
        type: 'upload-already-linked',
        title: 'Upload already attached',
        status: HttpStatus.CONFLICT,
        detail: 'This file is already attached to an item. Upload it again to attach it here.',
      });
    }
    await this.sections.cache(
      { declarationId, sectionKey, savedVersion: saved.draftVersion },
      saved.contents,
    );
    // Marked in documents (so its orphan sweep keeps the object) only once the link is stored: a
    // link refused above leaves no mark. If the mark fails, the link is taken back.
    try {
      await this.documents.markLinked(tenant, uploadId);
    } catch {
      await this.takeBack(person, attachment);
      throw new ProblemException({
        type: 'documents-unavailable',
        title: 'Documents unavailable',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'The file could not be attached. Try again.',
      });
    }
    return {
      attachment: {
        id: attachment.id,
        sectionKey,
        itemId,
        uploadId,
        fileName,
        sha256: attachment.sha256,
        size: attachment.size,
        linkedAt: attachment.linkedAt.toISOString(),
      },
      draftVersion: saved.draftVersion,
    };
  }

  /**
   * Removes an attachment from its item: the row and the reference in the section. 404 when the
   * draft or the attachment is not the caller's, 409 when the draft is not editable.
   */
  async unlink(
    principal: Principal,
    declarationId: string,
    attachmentId: string,
  ): Promise<{ draftVersion: number }> {
    const person: PersonContext = personOf(principal);
    if (!UUID.test(attachmentId)) notFoundIfInvisible(null);
    const saved = await withPerson(this.db, person, async (tx) => {
      const declaration = notFoundIfInvisible(await draftOf(tx, declarationId));
      const [found] = await tx
        .select()
        .from(declarationAttachments)
        .where(
          and(
            eq(declarationAttachments.id, attachmentId),
            eq(declarationAttachments.declarationId, declarationId),
          ),
        )
        .limit(1);
      return this.remove(tx, declaration, notFoundIfInvisible(found));
    });
    await this.cacheRemoved(declarationId, saved);
    return { draftVersion: saved.draftVersion };
  }

  /**
   * Takes back a link whose mark in documents failed after it was stored: the row and the
   * reference are removed again in a transaction of their own, which bumps the draft version and
   * records the unlink. Nothing to do when the draft or the row went meanwhile (a discard or a
   * save removing the item unlinked it already).
   */
  private async takeBack(person: PersonContext, attachment: AttachmentRow): Promise<void> {
    const removed = await withPerson(this.db, person, async (tx) => {
      const declaration = await liveDeclaration(tx, attachment.declarationId, { lock: true });
      if (!declaration) return null;
      const [stored] = await tx
        .select()
        .from(declarationAttachments)
        .where(eq(declarationAttachments.id, attachment.id))
        .limit(1);
      return stored ? this.remove(tx, declaration, stored) : null;
    });
    if (removed) await this.cacheRemoved(attachment.declarationId, removed);
  }

  /**
   * Removes an attachment in the transaction (its declaration row locked): the row, the reference
   * in its section (re-sealed at a bumped draft version) and the unlink event.
   */
  private async remove(
    tx: Transaction,
    declaration: DeclarationRow,
    attachment: AttachmentRow,
  ): Promise<Removed> {
    const [section] = await tx
      .select()
      .from(declarationSections)
      .where(sectionIs(declaration.id, attachment.sectionKey))
      .limit(1);
    await tx.delete(declarationAttachments).where(eq(declarationAttachments.id, attachment.id));
    let contents: SectionContents | undefined;
    let draftVersion = declaration.draftVersion;
    if (section) {
      contents = withoutAttachment(
        await this.sections.open(declaration.tenant, section),
        attachment.uploadId,
      );
      draftVersion = await this.store(tx, declaration, attachment.sectionKey, contents);
    }
    await this.events.record(
      tx,
      declarationAttachmentUnlinked(declaration.tenant, {
        declarationId: declaration.id,
        uploadId: attachment.uploadId,
      }),
    );
    return { draftVersion, sectionKey: attachment.sectionKey, contents };
  }

  private async cacheRemoved(declarationId: string, removed: Removed): Promise<void> {
    if (!removed.contents) return;
    await this.sections.cache(
      { declarationId, sectionKey: removed.sectionKey, savedVersion: removed.draftVersion },
      removed.contents,
    );
  }

  /** Re-encrypts the section and bumps the draft version (the declaration row is locked). */
  private async store(
    tx: Transaction,
    declaration: DeclarationRow,
    sectionKey: StatementKey,
    contents: SectionContents,
  ): Promise<number> {
    return notFoundIfInvisible(
      await storeSection(tx, this.sections, declaration, sectionKey, contents, {
        now: this.clock.now(),
      }),
    );
  }

  /** The Commission's clean upload, if it was uploaded as a declaration attachment. */
  private async verified(tenant: string, uploadId: string): Promise<CleanUpload> {
    const upload = await this.documentsCall(uploadId, () =>
      this.documents.getCleanUpload(tenant, uploadId),
    );
    if (upload.purpose !== DECLARATION_ATTACHMENT_PURPOSE) {
      throw new ProblemException({
        type: 'upload-wrong-purpose',
        title: 'Not a declaration attachment',
        status: HttpStatus.CONFLICT,
        detail: 'This file was not uploaded as a declaration attachment.',
      });
    }
    return upload;
  }

  /** A documents call with its refusals as problems. */
  private async documentsCall<T>(uploadId: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof UploadNotFound) {
        throw new ProblemException({
          type: 'upload-not-found',
          title: 'Upload not found',
          status: HttpStatus.CONFLICT,
          detail: `There is no upload ${uploadId} for this Commission.`,
        });
      }
      if (error instanceof UploadNotClean) {
        throw new ProblemException({
          type: 'upload-not-clean',
          title: 'Upload not clean',
          status: HttpStatus.CONFLICT,
          detail:
            'This file has not passed the security scan (still scanning, infected or rejected) and was not attached.',
        });
      }
      if (error instanceof DocumentsUnavailable) {
        throw new ProblemException({
          type: 'documents-unavailable',
          title: 'Documents unavailable',
          status: HttpStatus.SERVICE_UNAVAILABLE,
          detail: 'The file could not be checked. Try again.',
        });
      }
      throw error;
    }
  }
}

/**
 * The caller's live draft, locked for the change unless `lock` is false (the checks made before
 * calling documents): null when it is not theirs or discarded, 409 when it is no longer a draft.
 */
async function draftOf(
  tx: Transaction,
  declarationId: string,
  { lock = true }: { lock?: boolean } = {},
): Promise<DeclarationRow | null> {
  const declaration = await liveDeclaration(tx, declarationId, { lock });
  if (!declaration) return null;
  if (!isEditable(declaration.status)) throw declarationNotDraft('edited');
  return declaration;
}

/**
 * A statement section of the caller's draft that items can be attached in: null when either is
 * not visible, 409 when the draft is not editable or the statement is archived.
 */
async function editableSection(
  tx: Transaction,
  declarationId: string,
  sectionKey: StatementKey,
  { lock }: { lock: boolean },
): Promise<{ declaration: DeclarationRow; section: SectionRow } | null> {
  const declaration = await draftOf(tx, declarationId, { lock });
  if (!declaration) return null;
  const [section] = await tx
    .select()
    .from(declarationSections)
    .where(sectionIs(declarationId, sectionKey))
    .limit(1);
  if (!section) return null;
  if (section.metadata.archived === true) throw sectionArchived();
  return { declaration, section };
}

/** What removing an attachment changed: the version, and the section re-sealed unless it was gone. */
interface Removed {
  draftVersion: number;
  sectionKey: StatementKey;
  contents?: SectionContents;
}
