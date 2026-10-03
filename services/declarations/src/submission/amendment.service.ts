import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import {
  type Database,
  FieldCipher,
  InjectDatabase,
  type PersonContext,
  withPerson,
} from '@adili/data-access';
import { EventPublisher, type NewEvent } from '@adili/events';
import type { DeclarationSectionKey, DeclarationV1 } from '@adili/forms';
import { desc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { deleteWhatGoesWithTheDraft } from '../drafts/draft-ended.js';
import { Clock } from '../clock.js';
import type {
  DeclarationVersion,
  DeclarationVersionDetail,
} from '../declaration/representation.js';
import {
  declarations,
  type DeclarationStatus,
  declarationVersions,
} from '../declaration/schema.js';
import { openSnapshot, versionOf, versionRow } from '../declaration/versions.js';
import { amendRefusal } from '../declaration/window.js';
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
import {
  type DeclarationRow,
  liveDeclaration,
  obligationOf,
  sectionIs,
} from '../drafts/repository.js';
import type { Declaration } from '../drafts/representation.js';
import { declarationAttachments, declarationSections } from '../drafts/schema.js';
import { type SealedSection, SectionCipher } from '../drafts/section-cipher.js';
import { isUuid } from '../guards.js';
import { nairobiDate } from '../obligations/dates.js';
import {
  attachmentsOfVersion,
  type SectionFromVersion,
  sectionsOfVersion,
  type VersionAttachment,
} from './amendment.js';
import { declarationAmendmentDiscarded, declarationAmendmentStarted } from './events.js';
import { amendRefused } from './problems.js';

/** How often a reset is prepared again when the declaration moved on meanwhile. */
const MAX_RESET_ATTEMPTS = 3;

/** What a reset needs from other services, prepared with no transaction open. */
interface Prepared {
  /** The version in force it was prepared from. */
  version: number;
  document: DeclarationV1;
  /** Each section of the version, sealed. */
  sealed: ReadonlyMap<DeclarationSectionKey, SealedSection>;
  /** The attachment links the version's items hold. */
  attachments: readonly VersionAttachment[];
  /** Sizes of the version's uploads not linked when prepared; null when no longer clean. */
  sizes: ReadonlyMap<string, number | null>;
}

/**
 * Whether and how a reset changes the declaration: null to answer it as it is, a refusal thrown.
 * Asked before the work is prepared, and again with the declaration locked.
 */
type Decide = (tx: Transaction, declaration: DeclarationRow) => Promise<ResetPlan | null>;

/** What a reset does to the declaration. */
interface ResetPlan {
  set: { status: DeclarationStatus; amendingFromVersion: number | null };
  event: NewEvent;
}

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
    const now = this.clock.now();
    const reset = await this.reset(principal, declarationId, async (tx, declaration) => {
      if (declaration.status === 'amending') return null;
      const refusal = amendRefusal(
        declaration.status,
        await obligationOf(tx, declaration),
        nairobiDate(now),
      );
      if (refusal) throw amendRefused(refusal);
      const fromVersion = inForce(declaration);
      return {
        set: { status: 'amending', amendingFromVersion: fromVersion },
        event: declarationAmendmentStarted(declaration.tenant, {
          declarationId: declaration.id,
          fromVersion,
        }),
      };
    });
    if (reset) await this.cache(reset);
    return this.drafts.get(principal, declarationId);
  }

  /**
   * Discards the amendment in progress, recording `declaration.amendment-discarded.v1`: the
   * declaration is `submitted` again, its sections as the version in force has them, and the
   * amendment's registry suggestions are deleted. A declaration with no amendment in progress is
   * answered as it is; 409 `not-submitted` for a draft (which is discarded with
   * `discardDeclaration`).
   */
  async discard(principal: Principal, declarationId: string): Promise<Declaration> {
    const reset = await this.reset(principal, declarationId, (_tx, declaration) => {
      if (declaration.status === 'submitted') return Promise.resolve(null);
      if (declaration.status !== 'amending') throw amendRefused('not-submitted');
      return Promise.resolve({
        set: { status: 'submitted', amendingFromVersion: null },
        event: declarationAmendmentDiscarded(declaration.tenant, {
          declarationId: declaration.id,
          version: inForce(declaration),
        }),
      });
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
   * Puts the declaration's sections back as the version in force has them, if `decide` says to,
   * with the status and event it gives (it refuses by throwing, or answers the declaration as it
   * is with null). What calls other services is done first, with no transaction open (ADR-013):
   * the version decrypted, its sections sealed, and the uploads it would relink checked with
   * documents. The transaction that locks the declaration decides again and only writes, provided
   * the declaration is still as prepared; if it moved on meanwhile (another request reset it, or
   * relinked), the work is prepared again.
   */
  private async reset(
    principal: Principal,
    declarationId: string,
    decide: Decide,
  ): Promise<Reset | null> {
    const person = personOf(principal);
    for (let attempt = 1; ; attempt++) {
      const prepared = await this.prepare(person, declarationId, decide);
      if (prepared === 'nothing') return null;
      const outcome = await withPerson(this.db, person, async (tx) => {
        const declaration = notFoundIfInvisible(
          await liveDeclaration(tx, declarationId, { lock: true }),
        );
        const plan = await decide(tx, declaration);
        if (!plan) return { reset: null };
        if (!(await this.stillAsPrepared(tx, declaration, prepared))) {
          return 'stale' as const;
        }
        const reset = await this.write(tx, declaration, prepared, plan.set);
        await this.events.record(tx, plan.event);
        return { reset };
      });
      if (outcome !== 'stale') return outcome.reset;
      if (attempt === MAX_RESET_ATTEMPTS) {
        throw new Error(`Declaration ${declarationId} kept changing while it was reset`);
      }
    }
  }

  /**
   * Everything a reset needs from other services, read without locking the declaration: the
   * version in force's sections, sealed, and the size of every upload of the version that is not
   * linked now (null when documents no longer has it clean). `nothing` when `decide` answers the
   * declaration as it is; 404 when it is not visible, and `decide`'s refusal, before any of it.
   */
  private async prepare(
    person: PersonContext,
    declarationId: string,
    decide: Decide,
  ): Promise<Prepared | 'nothing'> {
    const found = await withPerson(this.db, person, async (tx) => {
      const declaration = notFoundIfInvisible(await liveDeclaration(tx, declarationId));
      if (!(await decide(tx, declaration))) return null;
      const row = await versionRow(tx, declaration.id, inForce(declaration));
      if (!row) throw new Error(`Declaration ${declaration.id} has no version in force`);
      const linked = await tx
        .select({ uploadId: declarationAttachments.uploadId })
        .from(declarationAttachments)
        .where(eq(declarationAttachments.declarationId, declaration.id));
      return { declaration, row, linked: new Set(linked.map((link) => link.uploadId)) };
    });
    if (!found) return 'nothing';
    const { declaration, row, linked } = found;
    const document = await openSnapshot(this.cipher, row);
    // Contents do not depend on the bio's locked or pre-filled fields, which only the metadata
    // carries; the metadata is derived again under the lock.
    const sections = sectionsOfVersion(document, {});
    const sealed = new Map(
      await Promise.all(
        sections.map(
          async (section) =>
            [
              section.key,
              await this.sections.seal(
                declaration.tenant,
                declaration.id,
                section.key,
                section.contents,
              ),
            ] as const,
        ),
      ),
    );
    const attachments = attachmentsOfVersion(sections);
    const relinked = attachments.filter((attachment) => !linked.has(attachment.ref.uploadId));
    const sizes = new Map(
      await Promise.all(
        relinked.map(
          async ({ ref }) =>
            [ref.uploadId, await this.uploadSize(declaration.tenant, ref.uploadId)] as const,
        ),
      ),
    );
    return { version: row.version, document, sealed, attachments, sizes };
  }

  /** Whether the locked declaration is still at the version, and has the uploads, prepared. */
  private async stillAsPrepared(
    tx: Transaction,
    declaration: DeclarationRow,
    prepared: Prepared,
  ): Promise<boolean> {
    if (declaration.currentVersion !== prepared.version) return false;
    const linked = await this.linked(tx, declaration.id);
    const uploads = new Set(linked.map((link) => link.uploadId));
    return prepared.attachments.every(
      ({ ref }) => uploads.has(ref.uploadId) || prepared.sizes.has(ref.uploadId),
    );
  }

  /**
   * In the transaction (the declaration row locked, and as prepared): replaces every section,
   * archived statements included, with the version in force's, sealed at the next draft
   * version; brings the attachment links back to the ones its items hold; deletes the draft's
   * registry suggestions; and sets the declaration's status.
   */
  private async write(
    tx: Transaction,
    declaration: DeclarationRow,
    prepared: Prepared,
    set: ResetPlan['set'],
  ): Promise<Reset> {
    const [bio] = await tx
      .select({ metadata: declarationSections.metadata })
      .from(declarationSections)
      .where(sectionIs(declaration.id, 'bio'));
    const sections = sectionsOfVersion(prepared.document, {
      lockedFields: bio?.metadata.lockedFields,
      prefilledFields: bio?.metadata.prefilledFields,
    });
    const draftVersion = declaration.draftVersion + 1;

    await tx
      .delete(declarationSections)
      .where(eq(declarationSections.declarationId, declaration.id));
    await tx.insert(declarationSections).values(
      sections.map((section) => {
        const { ciphertext, envelope } = prepared.sealed.get(section.key) ?? notSealed();
        return {
          declarationId: declaration.id,
          sectionKey: section.key,
          ciphertext,
          envelope,
          completeness: section.completeness,
          metadata: section.metadata,
          savedVersion: draftVersion,
          updatedAt: this.clock.now(),
        };
      }),
    );
    await this.relink(tx, declaration, prepared.attachments, prepared.sizes);
    // Registry suggestions and the Ask Adili conversation expire with the draft (specs 05b and
    // 11, S7): a discarded amendment's go with it, and an amendment starts without any (the submit
    // deleted them).
    await deleteWhatGoesWithTheDraft(tx, declaration.id);
    await tx
      .update(declarations)
      .set({ ...set, draftVersion })
      .where(eq(declarations.id, declaration.id));
    return { declarationId: declaration.id, draftVersion, sections };
  }

  /**
   * Brings the declaration's attachment links back to the ones the version's items hold: a link
   * the amendment added is removed, a link it removed is restored under its old id with the size
   * documents gave for it, each with its event. A restored upload documents no longer has clean
   * (no size) is left out, its reference kept in the item.
   */
  private async relink(
    tx: Transaction,
    declaration: DeclarationRow,
    wanted: readonly VersionAttachment[],
    sizes: ReadonlyMap<string, number | null>,
  ): Promise<void> {
    const now = this.clock.now();
    const stored = await this.linked(tx, declaration.id);
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
      const size = sizes.get(ref.uploadId) ?? null;
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

  private linked(tx: Transaction, declarationId: string) {
    return tx
      .select()
      .from(declarationAttachments)
      .where(eq(declarationAttachments.declarationId, declarationId));
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
