import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, FieldCipher, InjectDatabase, withPerson } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { desc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../clock.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import {
  DocumentsClient,
  DocumentsUnavailable,
  UploadNotClean,
  UploadNotFound,
} from '../documents/documents-client.js';
import { personOf } from '../drafts/access.js';
import { DraftsService } from '../drafts/drafts.service.js';
import { declarationAttachmentLinked, declarationAttachmentUnlinked } from '../drafts/events.js';
import { type DeclarationRow, liveDeclaration, sectionIs } from '../drafts/repository.js';
import type { Declaration } from '../drafts/representation.js';
import {
  declarationAttachments,
  declarationSections,
  declarations,
  type DeclarationStatus,
} from '../drafts/schema.js';
import { SectionCipher } from '../drafts/section-cipher.js';
import { isUuid } from '../guards.js';
import { nairobiDate } from '../obligations/dates.js';
import { filingObligations } from '../obligations/schema.js';
import {
  attachmentsOfVersion,
  type SectionFromVersion,
  sectionsOfVersion,
  type VersionAttachment,
} from './amendment.js';
import { declarationAmendmentDiscarded, declarationAmendmentStarted } from './events.js';
import { amendRefused } from './problems.js';
import type { DeclarationVersion, DeclarationVersionDetail } from './representation.js';
import { declarationVersions } from './schema.js';
import { versionOf } from './submission.service.js';
import { openSnapshot, versionRow } from './versions.js';
import { amendRefusal } from './window.js';

/** The sections a reset wrote, for the cache once committed. */
interface Reset {
  declarationId: string;
  draftVersion: number;
  sections: SectionFromVersion[];
}

/**
 * Amendments and versions (spec 06). Amend reopens a submitted declaration until its obligation's
 * due date (Africa/Nairobi, by the service's clock): the version in force is decrypted and copied
 * back into editable sections, re-encrypted as sections are, and the declaration is `amending`
 * until the amendment is submitted as the next version (the submit transaction) or discarded,
 * which puts the sections back as the version in force has them. The version itself never
 * changes. Attachment links follow the sections: a reset takes back what the amendment linked
 * and relinks what it unlinked. Declarant only, under person row-level security; anyone else,
 * staff included, gets 404.
 */
@Injectable()
export class AmendmentService {
  private readonly logger = new Logger(AmendmentService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly sections: SectionCipher,
    private readonly cipher: FieldCipher,
    private readonly events: EventPublisher,
    private readonly documents: DocumentsClient,
    private readonly drafts: DraftsService,
    private readonly clock: Clock,
  ) {}

  /**
   * Reopens the submitted declaration for amendment, recording
   * `declaration.amendment-started.v1`. An amendment already in progress is answered as it is
   * (a retried amend starts nothing and copies nothing again). 409 `not-submitted` for a draft,
   * `amendment-window-closed` after the obligation's due date.
   */
  async amend(principal: Principal, declarationId: string): Promise<Declaration> {
    const person = personOf(principal);
    const now = this.clock.now();
    const reset = await withPerson(this.db, person, async (tx) => {
      const declaration = notFoundIfInvisible(
        await liveDeclaration(tx, declarationId, { lock: true }),
      );
      if (declaration.status === 'amending') return null;
      const [obligation] = await tx
        .select({ status: filingObligations.status, dueDate: filingObligations.dueDate })
        .from(filingObligations)
        .where(eq(filingObligations.id, declaration.obligationId));
      if (!obligation) throw new Error(`Declaration ${declaration.id} has no obligation`);
      const refusal = amendRefusal(declaration.status, obligation, nairobiDate(now));
      if (refusal) throw amendRefused(refusal);
      const fromVersion = inForce(declaration);
      const written = await this.resetToVersion(tx, declaration, now, {
        status: 'amending',
        amendingFromVersion: fromVersion,
      });
      await this.events.record(
        tx,
        declarationAmendmentStarted(declaration.tenant, {
          declarationId: declaration.id,
          fromVersion,
        }),
      );
      return written;
    });
    if (reset) await this.cache(reset);
    return this.drafts.get(principal, declarationId);
  }

  /**
   * Discards the amendment in progress, recording `declaration.amendment-discarded.v1`: the
   * declaration is `submitted` again, its sections as the version in force has them. A
   * declaration with no amendment in progress is answered as it is; 409 `not-submitted` for a
   * draft (which is discarded with `discardDeclaration`).
   */
  async discard(principal: Principal, declarationId: string): Promise<Declaration> {
    const person = personOf(principal);
    const now = this.clock.now();
    const reset = await withPerson(this.db, person, async (tx) => {
      const declaration = notFoundIfInvisible(
        await liveDeclaration(tx, declarationId, { lock: true }),
      );
      if (declaration.status === 'submitted') return null;
      if (declaration.status !== 'amending') throw amendRefused('not-submitted');
      const version = inForce(declaration);
      const written = await this.resetToVersion(tx, declaration, now, {
        status: 'submitted',
        amendingFromVersion: null,
      });
      await this.events.record(
        tx,
        declarationAmendmentDiscarded(declaration.tenant, {
          declarationId: declaration.id,
          version,
        }),
      );
      return written;
    });
    if (reset) await this.cache(reset);
    return this.drafts.get(principal, declarationId);
  }

  /** The declaration's submitted versions, newest first; none for a draft. */
  async versions(principal: Principal, declarationId: string): Promise<DeclarationVersion[]> {
    const rows = await withPerson(this.db, personOf(principal), async (tx) => {
      const declaration = await liveDeclaration(tx, declarationId);
      if (!declaration) return null;
      return tx
        .select()
        .from(declarationVersions)
        .where(eq(declarationVersions.declarationId, declaration.id))
        .orderBy(desc(declarationVersions.version));
    });
    const now = this.clock.now();
    return notFoundIfInvisible(rows).map((row) => versionOf(row, now));
  }

  /** One submitted version with its document, decrypted for the declarant. */
  async version(
    principal: Principal,
    declarationId: string,
    version: number,
  ): Promise<DeclarationVersionDetail> {
    const row = notFoundIfInvisible(
      await withPerson(this.db, personOf(principal), (tx) =>
        versionRow(tx, declarationId, version),
      ),
    );
    const document = await openSnapshot(this.cipher, row);
    return {
      ...versionOf(row, this.clock.now()),
      document: document as unknown as Record<string, unknown>,
    };
  }

  /**
   * In the transaction (the declaration row locked): replaces every section, archived statements
   * included, with the version in force's, sealed at the next draft version; brings the
   * attachment links back to the ones its items hold; and sets the declaration's status.
   */
  private async resetToVersion(
    tx: Transaction,
    declaration: DeclarationRow,
    now: Date,
    set: { status: DeclarationStatus; amendingFromVersion: number | null },
  ): Promise<Reset> {
    const row = await versionRow(tx, declaration.id, inForce(declaration));
    if (!row) throw new Error(`Declaration ${declaration.id} has no version in force`);
    const document = await openSnapshot(this.cipher, row);
    const [bio] = await tx
      .select({ metadata: declarationSections.metadata })
      .from(declarationSections)
      .where(sectionIs(declaration.id, 'bio'));
    const sections = sectionsOfVersion(document, {
      lockedFields: bio?.metadata.lockedFields ?? [],
    });
    const draftVersion = declaration.draftVersion + 1;
    const sealed = await Promise.all(
      sections.map((section) =>
        this.sections.seal(declaration.tenant, declaration.id, section.key, section.contents),
      ),
    );

    await tx
      .delete(declarationSections)
      .where(eq(declarationSections.declarationId, declaration.id));
    await tx.insert(declarationSections).values(
      sections.map((section, index) => {
        const { ciphertext, envelope } = sealed[index] ?? notSealed();
        return {
          declarationId: declaration.id,
          sectionKey: section.key,
          ciphertext,
          envelope,
          completeness: section.completeness,
          metadata: section.metadata,
          savedVersion: draftVersion,
          updatedAt: now,
        };
      }),
    );
    await this.relink(tx, declaration, attachmentsOfVersion(sections), now);
    await tx
      .update(declarations)
      .set({ ...set, draftVersion })
      .where(eq(declarations.id, declaration.id));
    return { declarationId: declaration.id, draftVersion, sections };
  }

  /**
   * Brings the declaration's attachment links back to the ones the version's items hold: a link
   * the amendment added is removed, a link it removed is restored under its old id (its size read
   * again from documents), each with its event. A restored upload documents no longer has clean
   * is left out, its reference kept in the item; documents unreachable is a 503.
   */
  private async relink(
    tx: Transaction,
    declaration: DeclarationRow,
    wanted: readonly VersionAttachment[],
    now: Date,
  ): Promise<void> {
    const stored = await tx
      .select()
      .from(declarationAttachments)
      .where(eq(declarationAttachments.declarationId, declaration.id));
    const wantedUploads = new Set(wanted.map((attachment) => attachment.ref.uploadId));
    const storedUploads = new Set(stored.map((attachment) => attachment.uploadId));

    for (const attachment of stored) {
      if (wantedUploads.has(attachment.uploadId)) continue;
      await tx.delete(declarationAttachments).where(eq(declarationAttachments.id, attachment.id));
      await this.events.record(
        tx,
        declarationAttachmentUnlinked(declaration.tenant, {
          declarationId: declaration.id,
          uploadId: attachment.uploadId,
        }),
      );
    }
    for (const { sectionKey, itemId, ref } of wanted) {
      if (storedUploads.has(ref.uploadId)) continue;
      const size = await this.uploadSize(declaration.tenant, ref.uploadId);
      if (size === null) continue;
      await tx.insert(declarationAttachments).values({
        id: isUuid(ref.attachmentId) ? ref.attachmentId : uuidv7(),
        declarationId: declaration.id,
        sectionKey,
        itemId,
        uploadId: ref.uploadId,
        sha256: ref.sha256,
        size,
        linkedAt: now,
      });
      await this.events.record(
        tx,
        declarationAttachmentLinked(declaration.tenant, {
          declarationId: declaration.id,
          uploadId: ref.uploadId,
        }),
      );
    }
  }

  /** The clean upload's size, or null when documents no longer has it clean. */
  private async uploadSize(tenant: string, uploadId: string): Promise<number | null> {
    try {
      return (await this.documents.getCleanUpload(tenant, uploadId)).size;
    } catch (error) {
      if (error instanceof UploadNotFound || error instanceof UploadNotClean) {
        this.logger.warn({ uploadId, err: error.name }, 'Attachment of the version not relinked');
        return null;
      }
      if (error instanceof DocumentsUnavailable) {
        throw new ProblemException({
          type: 'documents-unavailable',
          title: 'Documents unavailable',
          status: HttpStatus.SERVICE_UNAVAILABLE,
          detail: "The version's attachments could not be checked. Try again.",
        });
      }
      throw error;
    }
  }

  private async cache(reset: Reset): Promise<void> {
    await Promise.all(
      reset.sections.map((section) =>
        this.sections.cache(
          {
            declarationId: reset.declarationId,
            sectionKey: section.key,
            savedVersion: reset.draftVersion,
          },
          section.contents,
        ),
      ),
    );
  }
}

/** The version in force of a submitted (or amending) declaration. */
function inForce(declaration: DeclarationRow): number {
  if (declaration.currentVersion === null) {
    throw new Error(`Declaration ${declaration.id} has no version in force`);
  }
  return declaration.currentVersion;
}

function notSealed(): never {
  throw new Error('A section was not sealed');
}
