import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, type PersonContext, withPerson } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../clock.js';
import type { DeclarationsSchema } from '../db/schema.js';
import {
  type CleanUpload,
  DECLARATION_ATTACHMENT_PURPOSE,
  DocumentsClient,
  DocumentsUnavailable,
  UploadNotClean,
  UploadNotFound,
} from '../documents/documents-client.js';
import type { Transaction } from '../db/transaction.js';
import { attachmentFileName, hasItem, withAttachment, withoutAttachment } from './attachments.js';
import {
  personOf,
  sectionIs,
  validationProblem,
  violatedUniqueConstraint,
} from './drafts.service.js';
import { declarationAttachmentLinked, declarationAttachmentUnlinked } from './events.js';
import { attachmentLinkSchema, type DeclarationAttachment } from './representation.js';
import { declarationAttachments, declarationSections, declarations } from './schema.js';
import { SectionCipher } from './section-cipher.js';
import type { SectionContents } from './sections.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DeclarationRow = typeof declarations.$inferSelect;
type SectionRow = typeof declarationSections.$inferSelect;
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
    const { sectionKey, itemId, uploadId } = parsed.data;

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
      const [declaration] = await tx
        .select()
        .from(declarations)
        .where(
          and(eq(declarations.id, attachment.declarationId), ne(declarations.status, 'discarded')),
        )
        .limit(1)
        .for('update');
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
  ): Promise<{ draftVersion: number; sectionKey: string; contents?: SectionContents }> {
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

  private async cacheRemoved(
    declarationId: string,
    removed: { draftVersion: number; sectionKey: string; contents?: SectionContents },
  ): Promise<void> {
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
    sectionKey: string,
    contents: SectionContents,
  ): Promise<number> {
    const sealed = await this.sections.seal(
      declaration.tenant,
      declaration.id,
      sectionKey,
      contents,
    );
    const [bumped] = await tx
      .update(declarations)
      .set({ draftVersion: sql`${declarations.draftVersion} + 1` })
      .where(eq(declarations.id, declaration.id))
      .returning({ draftVersion: declarations.draftVersion });
    const draftVersion = notFoundIfInvisible(bumped).draftVersion;
    await tx
      .update(declarationSections)
      .set({
        ciphertext: sealed.ciphertext,
        envelope: sealed.envelope,
        savedVersion: draftVersion,
        updatedAt: this.clock.now(),
      })
      .where(sectionIs(declaration.id, sectionKey));
    return draftVersion;
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
  if (!UUID.test(declarationId)) return null;
  const query = tx
    .select()
    .from(declarations)
    .where(and(eq(declarations.id, declarationId), ne(declarations.status, 'discarded')))
    .limit(1);
  const [declaration] = lock ? await query.for('update') : await query;
  if (!declaration) return null;
  if (declaration.status !== 'draft') {
    throw new ProblemException({
      type: 'declaration-not-draft',
      title: 'Not a draft',
      status: HttpStatus.CONFLICT,
      detail: 'Only a draft declaration can be edited.',
    });
  }
  return declaration;
}

/**
 * A statement section of the caller's draft that items can be attached in: null when either is
 * not visible (or the key is not a statement's), 409 when the draft is not editable or the
 * statement is archived.
 */
async function editableSection(
  tx: Transaction,
  declarationId: string,
  sectionKey: string,
  { lock }: { lock: boolean },
): Promise<{ declaration: DeclarationRow; section: SectionRow } | null> {
  if (!sectionKey.startsWith('statement:')) return null;
  const declaration = await draftOf(tx, declarationId, { lock });
  if (!declaration) return null;
  const [section] = await tx
    .select()
    .from(declarationSections)
    .where(sectionIs(declarationId, sectionKey))
    .limit(1);
  if (!section) return null;
  if (section.metadata.archived === true) {
    throw new ProblemException({
      type: 'section-archived',
      title: 'Section archived',
      status: HttpStatus.CONFLICT,
      detail: 'This person was removed from the household; add them back to edit it.',
    });
  }
  return { declaration, section };
}
