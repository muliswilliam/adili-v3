import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import {
  canonicalJson,
  isFreshStepUp,
  notFoundIfInvisible,
  type Principal,
  STEP_UP_ACR,
} from '@adili/api-kit';
import {
  type Database,
  FieldCipher,
  type SealedField,
  InjectDatabase,
  switchTenant,
  withPerson,
} from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import type { DeclarationV1 } from '@adili/forms';
import { allocateReference, declarationSchemes, issuerCode } from '@adili/numbering';
import { and, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../clock.js';
import { config } from '../config.js';
import {
  declarationItems,
  declarations,
  declarationVersions,
  isEditable,
} from '../declaration/schema.js';
import { versionOf, versionRecordId } from '../declaration/versions.js';
import { isLate, obligationRefusal } from '../declaration/window.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import { personOf } from '../drafts/access.js';
import { DraftsService } from '../drafts/drafts.service.js';
import {
  type DeclarationRow,
  documentFrame,
  liveDeclaration,
  liveSections,
  obligationOf,
} from '../drafts/repository.js';
import { obligationDrafts } from '../drafts/schema.js';
import { SectionCipher } from '../drafts/section-cipher.js';
import { reviewDraft } from '../drafts/summary.js';
import { nairobiDate } from '../obligations/dates.js';
import type { ObligationStatus } from '../obligations/engine.js';
import { obligationStatusChanged } from '../obligations/events.js';
import { filingObligations } from '../obligations/schema.js';
import { noChanges, ObligationWorkflows, tellWorkflows } from '../obligations/workflows.js';
import { deleteSuggestions } from '../suggestions/expiry.js';
import { declarationSubmitted } from './events.js';
import { type DerivedItem, deriveItems } from './items.js';
import { incomplete, refused, stepUpRequired } from './problems.js';
import type { SubmissionResult } from './representation.js';

/** Key service calls in flight at once while items are encrypted. */
const ENCRYPT_CONCURRENCY = 16;
/** Items sealed at once: each item makes two key service calls (description and value). */
const ITEM_CONCURRENCY = ENCRYPT_CONCURRENCY / 2;
/** Tries at a submission whose declaration keeps changing between preparing and writing it. */
const MAX_SUBMIT_ATTEMPTS = 3;

type VersionRow = typeof declarationVersions.$inferSelect;
type ItemRow = typeof declarationItems.$inferInsert;

/** The legal record sealed, with the reference it carries and the hash of its plaintext. */
interface SealedSnapshot {
  reference: string;
  sealed: SealedField;
  sha256: string;
}

/** What a submission needs from the key service, prepared with no transaction open. */
interface Prepared {
  /** The declaration as read; the transaction goes ahead only while it is still so. */
  declaration: DeclarationRow;
  document: DeclarationV1;
  stepUp: StepUp;
  versionId: string;
  cycleYear: number;
  items: ItemRow[];
  /** Sealed already when the reference was known (an amendment); else sealed once allocated. */
  snapshot: SealedSnapshot | null;
}

/** What the transaction committed (or found committed, for a replay), for the response. */
interface Submitted {
  declarationId: string;
  tenant: string;
  obligationId: string;
  version: VersionRow;
  obligationStatus: ObligationStatus;
  /** Whether this submission filed the obligation (its workflow is told after commit). */
  filed: boolean;
}

/**
 * Submission (spec 06): the legal act, in one transaction. The declaration is checked in order:
 * the caller owns it, it is a draft or an amendment in progress, the token carries a fresh
 * step-up (checked here from the principal, never trusted to the BFF), and the assembled
 * `declaration.v1` document validates; its items are sealed then, with no lock held, since
 * sealing calls the key service (ADR-013). The transaction locks the declaration, goes ahead only
 * while it is as prepared (else it is prepared again), and checks the obligation takes it today.
 * Then the reference is allocated (first version only, gapless: a rollback returns the number),
 * the immutable version and its items are written encrypted, the previous version is superseded,
 * the declaration is submitted, its registry suggestions deleted (spec 05b S7), the obligation
 * filed, and the events recorded. The obligation's workflow is told after commit; a lost signal
 * is healed by the workflow reading the row. The `Idempotency-Key` store (api-kit) replays a
 * retried request; the key's hash is also kept on the version, so a retry whose stored answer was
 * lost still gets the same submission back rather than a conflict.
 */
@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly sections: SectionCipher,
    private readonly cipher: FieldCipher,
    private readonly events: EventPublisher,
    private readonly workflows: ObligationWorkflows,
    private readonly drafts: DraftsService,
    private readonly clock: Clock,
  ) {}

  async submit(
    principal: Principal,
    declarationId: string,
    idempotencyKey: string,
  ): Promise<SubmissionResult> {
    const person = personOf(principal);
    const keyHash = sha256(idempotencyKey);
    const now = this.clock.now();
    const today = nairobiDate(now);
    let submitted: Submitted | undefined;
    for (let attempt = 1; !submitted; attempt++) {
      const prepared = await this.prepare(principal, declarationId, keyHash, now);
      if ('replayed' in prepared) {
        submitted = prepared.replayed;
        break;
      }
      const outcome = await withPerson(this.db, person, async (tx) => {
        const declaration = notFoundIfInvisible(
          await liveDeclaration(tx, declarationId, { lock: true }),
        );
        if (!isEditable(declaration.status)) {
          const replayed = await this.replayed(tx, declaration, keyHash);
          if (replayed) return replayed;
          throw refused('not-a-draft');
        }
        if (!stillAsPrepared(declaration, prepared.declaration)) return 'stale' as const;

        // The obligation, the version and its items are the Commission's data, which the
        // declarant only reads: the rest of the transaction writes them in its tenant's context
        // (ADR-018), the person's still set for the declaration itself.
        await switchTenant(tx, { tenant: declaration.tenant, subject: person.subject });
        const obligation = await obligationOf(tx, declaration, { lock: true });
        const refusal = obligationRefusal(declaration.status, obligation, today);
        if (refusal) throw refused(refusal);

        return this.record(tx, {
          declaration,
          obligation,
          prepared,
          now,
          late: isLate(obligation.dueDate, today),
          keyHash,
        });
      });
      if (outcome !== 'stale') submitted = outcome;
      else if (attempt === MAX_SUBMIT_ATTEMPTS) {
        throw new Error(`Declaration ${declarationId} kept changing while it was submitted`);
      }
    }

    if (submitted.filed) {
      await tellWorkflows(this.workflows, this.logger, submitted.tenant, {
        ...noChanges(),
        filed: [submitted.obligationId],
      });
    }
    return {
      declaration: await this.drafts.get(principal, submitted.declarationId),
      version: versionOf(submitted.version, now),
      obligationStatus: submitted.obligationStatus,
    };
  }

  /**
   * The checks before the transaction and everything that calls the key service, with no lock
   * held (ADR-013): the declaration read, its preconditions in order (visible to the caller,
   * editable, a fresh step-up, the assembled document valid), its sections opened, the items
   * derived and sealed, and the snapshot sealed too when the reference is known already (an
   * amendment). The transaction then checks the declaration is still as read. A declaration that
   * is no longer editable is answered by `replayed` when this request submitted it already.
   */
  private async prepare(
    principal: Principal,
    declarationId: string,
    keyHash: string,
    now: Date,
  ): Promise<Prepared | { replayed: Submitted }> {
    const found = await withPerson(this.db, personOf(principal), async (tx) => {
      const declaration = notFoundIfInvisible(await liveDeclaration(tx, declarationId));
      // Only a draft or an amendment in progress, what can be edited, is submitted.
      if (!isEditable(declaration.status)) {
        const replayed = await this.replayed(tx, declaration, keyHash);
        if (replayed) return { replayed };
        throw refused('not-a-draft');
      }
      return { declaration, rows: await liveSections(tx, declaration.id) };
    });
    if (found.replayed) return { replayed: found.replayed };
    const { declaration, rows } = found;
    const stepUp = requireFreshStepUp(principal, now, declaration.id);

    const review = reviewDraft(
      documentFrame(declaration),
      await this.sections.openAll(declaration.tenant, rows),
      rows.map((row) => ({ key: row.sectionKey, completeness: row.completeness })),
    );
    if (!review.valid) throw incomplete(review.blocking);
    // It validated against declaration.v1 just above.
    const document = review.document as unknown as DeclarationV1;

    const { tenant } = declaration;
    const versionId = uuidv7();
    const cycleYear = Number(declaration.statementDate.slice(0, 4));
    const items = await this.sealItems(tenant, versionId, cycleYear, deriveItems(document));
    const snapshot =
      declaration.reference === null
        ? null
        : await this.sealSnapshot(tenant, versionId, document, declaration.reference, now);
    return { declaration, document, stepUp, versionId, cycleYear, items, snapshot };
  }

  /**
   * The legal record, sealed: the assembled document with its own reference and time (First
   * Schedule note 11), canonical JSON (RFC 8785) encrypted with the Commission's key, and the
   * SHA-256 of exactly the bytes that are encrypted.
   */
  private async sealSnapshot(
    tenant: string,
    versionId: string,
    document: DeclarationV1,
    reference: string,
    now: Date,
  ): Promise<SealedSnapshot> {
    const record: DeclarationV1 = {
      ...document,
      attestation: { ...document.attestation, declaredAt: now.toISOString(), reference },
    };
    const canonical = canonicalJson(record);
    const sealed = await this.cipher.encrypt({
      tenant,
      recordId: versionRecordId(versionId),
      plaintext: canonical,
    });
    return { reference, sealed, sha256: sha256(canonical) };
  }

  /** Writes the version, its items and everything the legal act changes, in the transaction. */
  private async record(
    tx: Transaction,
    {
      declaration,
      obligation,
      prepared,
      now,
      late,
      keyHash,
    }: {
      declaration: DeclarationRow;
      obligation: { id: string; status: ObligationStatus };
      prepared: Prepared;
      now: Date;
      late: boolean;
      keyHash: string;
    },
  ): Promise<Submitted> {
    const { tenant } = declaration;
    const { versionId, cycleYear, items, stepUp } = prepared;
    const version = (declaration.currentVersion ?? 0) + 1;
    // A first version's reference is allocated here, gapless (a rollback returns the number),
    // and its snapshot, which carries the reference, is sealed after it: the Commission and
    // year's counter stays locked across that one key service call, so concurrent first
    // submissions of the Commission and year queue behind it. Everything else that calls the
    // key service was done before the transaction.
    const snapshot =
      prepared.snapshot ??
      (await this.sealSnapshot(
        tenant,
        versionId,
        prepared.document,
        await allocateReference(tx, declarationSchemes[declaration.type], {
          issuer: issuerCode(tenant),
          period: cycleYear,
        }),
        now,
      ));
    const { reference } = snapshot;

    const [inserted] = await tx
      .insert(declarationVersions)
      .values({
        id: versionId,
        declarationId: declaration.id,
        version,
        cycleYear,
        tenant,
        personId: declaration.personId,
        reference,
        snapshotCiphertext: Buffer.from(snapshot.sealed.ciphertext, 'base64'),
        envelope: snapshot.sealed.envelope,
        canonicalSha256: snapshot.sha256,
        submittedAt: now,
        late,
        stepUpAcr: stepUp.acr,
        stepUpAuthTime: new Date(stepUp.authTime * 1000),
        stepUpTokenIdHash: stepUp.tokenId === null ? null : sha256(stepUp.tokenId),
        idempotencyKeyHash: keyHash,
      })
      .returning();
    if (!inserted) throw new Error('Version insert returned no row');
    if (items.length > 0) await tx.insert(declarationItems).values(items);
    if (declaration.currentVersion !== null) {
      await tx
        .update(declarationVersions)
        .set({ supersededAt: now })
        .where(
          and(
            eq(declarationVersions.declarationId, declaration.id),
            eq(declarationVersions.cycleYear, cycleYear),
            eq(declarationVersions.version, declaration.currentVersion),
            isNull(declarationVersions.supersededAt),
          ),
        );
    }
    await tx
      .update(declarations)
      .set({
        status: 'submitted',
        reference,
        currentVersion: version,
        amendingFromVersion: null,
      })
      .where(eq(declarations.id, declaration.id));
    // No longer a draft in progress for the Commission's counts (#300).
    await tx.delete(obligationDrafts).where(eq(obligationDrafts.declarationId, declaration.id));
    // Registry suggestions expire with the draft they were offered on (spec 05b S7).
    await deleteSuggestions(tx, declaration.id);

    // An amendment keeps the obligation filed as it was (when, and whether late); only the
    // version in force moves on.
    const filed = obligation.status !== 'filed';
    await tx
      .update(filingObligations)
      .set({
        status: 'filed',
        filedDeclarationId: declaration.id,
        filedVersionId: versionId,
        ...(filed && { filedAt: now, late }),
      })
      .where(eq(filingObligations.id, obligation.id));

    await this.events.record(
      tx,
      declarationSubmitted(tenant, {
        declarationId: declaration.id,
        versionId,
        version,
        reference,
        type: declaration.type,
        statementDate: declaration.statementDate,
        obligationId: obligation.id,
        amendment: version > 1,
        late,
      }),
    );
    if (filed) {
      await this.events.record(
        tx,
        obligationStatusChanged(tenant, {
          obligationId: obligation.id,
          from: obligation.status,
          to: 'filed',
          reason: null,
        }),
      );
    }
    return {
      declarationId: declaration.id,
      tenant,
      obligationId: obligation.id,
      version: inserted,
      obligationStatus: 'filed',
      filed,
    };
  }

  /**
   * The submission a retry of this request made, when the declaration's version in force was
   * submitted with the same `Idempotency-Key`: normally the api-kit store answers a retry first,
   * but a store write can fail after the commit.
   */
  private async replayed(
    tx: Transaction,
    declaration: DeclarationRow,
    keyHash: string,
  ): Promise<Submitted | null> {
    if (declaration.status !== 'submitted' || declaration.currentVersion === null) return null;
    const [version] = await tx
      .select()
      .from(declarationVersions)
      .where(
        and(
          eq(declarationVersions.declarationId, declaration.id),
          eq(declarationVersions.version, declaration.currentVersion),
        ),
      );
    if (version?.idempotencyKeyHash !== keyHash) return null;
    return {
      declarationId: declaration.id,
      tenant: declaration.tenant,
      obligationId: declaration.obligationId,
      version,
      obligationStatus: 'filed',
      filed: false,
    };
  }

  /**
   * The items as stored: clear columns, and the description and value each encrypted with the
   * Commission's key, bound to the item row.
   */
  private async sealItems(
    tenant: string,
    versionId: string,
    cycleYear: number,
    items: DerivedItem[],
  ): Promise<ItemRow[]> {
    return mapConcurrently(items, ITEM_CONCURRENCY, async (item) => {
      const id = uuidv7();
      const [description, value] = await Promise.all([
        this.cipher.encrypt({
          tenant,
          recordId: itemRecordId(id, 'description'),
          plaintext: item.description,
        }),
        this.cipher.encrypt({
          tenant,
          recordId: itemRecordId(id, 'value'),
          plaintext: JSON.stringify(item.value),
        }),
      ]);
      return {
        id,
        versionId,
        cycleYear,
        tenant,
        personKey: item.personKey,
        category: item.category,
        type: item.type,
        inKenya: item.inKenya,
        county: item.county,
        country: item.country,
        isJoint: item.isJoint,
        sharePercent: item.sharePercent,
        changeKind: item.changeKind,
        itemId: item.itemId,
        descriptionCiphertext: Buffer.from(description.ciphertext, 'base64'),
        valueCiphertext: Buffer.from(value.ciphertext, 'base64'),
        envelope: { description: description.envelope, value: value.envelope },
      };
    });
  }
}

/**
 * Whether the locked declaration is as it was prepared from: no section saved (`draftVersion`),
 * and the same status, version in force and reference.
 */
function stillAsPrepared(locked: DeclarationRow, prepared: DeclarationRow): boolean {
  return (
    locked.draftVersion === prepared.draftVersion &&
    locked.status === prepared.status &&
    locked.currentVersion === prepared.currentVersion &&
    locked.reference === prepared.reference
  );
}

/** The step-up a submission was made with: its evidence on the version. */
interface StepUp {
  acr: string;
  /** Seconds since the epoch. */
  authTime: number;
  /** The id (`jti`) of the token it came with, kept hashed. */
  tokenId: string | null;
}

/**
 * The token's step-up, or 403 unless it was issued after a fresh one-time code (`acr` step-up)
 * no more than five minutes ago by the service's clock. An `auth_time` ahead of the clock counts
 * only within the clock skew allowed (a minute): further ahead, it is not trusted as fresh.
 */
function requireFreshStepUp(principal: Principal, now: Date, declarationId: string): StepUp {
  const { acr, authTime } = principal;
  if (acr !== STEP_UP_ACR || authTime === null) {
    throw stepUpRequired(
      stepUpUrl(declarationId),
      'Confirm your identity with a one-time code before submitting.',
    );
  }
  if (!isFreshStepUp({ acr, authTime }, now)) {
    throw stepUpRequired(
      stepUpUrl(declarationId),
      'The one-time code was not confirmed in the last five minutes; confirm your identity again.',
    );
  }
  return { acr, authTime, tokenId: principal.tokenId };
}

/** The portal's step-up, returning to the declaration's summary (the BFF adds the outcome). */
function stepUpUrl(declarationId: string): string {
  const url = new URL('/auth/step-up', config.PORTAL_URL);
  url.searchParams.set('returnTo', `/declarations/${declarationId}/summary`);
  return url.toString();
}

/** The AAD record id of an item's encrypted field. */
export function itemRecordId(itemRowId: string, field: 'description' | 'value'): string {
  return `declaration-item:${itemRowId}/${field}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** `work` for every item, at most `limit` at once, results in the items' order. */
async function mapConcurrently<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
