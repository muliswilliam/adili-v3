import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { canonicalJson, notFoundIfInvisible, type Principal } from '@adili/api-kit';
import {
  type Database,
  FieldCipher,
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
import { declarationSubmitted } from './events.js';
import { type DerivedItem, deriveItems } from './items.js';
import { incomplete, refused, stepUpRequired } from './problems.js';
import type { SubmissionResult } from './representation.js';

/** The ACR of a token issued right after a fresh one-time code (the realm's LoA 2, spec 06). */
export const STEP_UP_ACR = 'step-up';
/**
 * How long a step-up counts for submission (spec 06: `auth_time` at most five minutes old). The
 * realm's max age for the one-time code (`loa-max-age`, 180 s) is shorter, so a step-up Keycloak
 * answers silently with the old `auth_time` still leaves time to affirm and submit.
 */
export const STEP_UP_MAX_AGE_SECONDS = 300;
/** Key service calls in flight at once while items are encrypted. */
const ENCRYPT_CONCURRENCY = 16;

type VersionRow = typeof declarationVersions.$inferSelect;
type ItemRow = typeof declarationItems.$inferInsert;

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
 * Submission (spec 06): the legal act, in one transaction. The declaration is locked, then checked
 * in order: the caller owns it, it is a draft or an amendment in progress, the token carries a
 * fresh step-up (checked here from the principal, never trusted to the BFF), the assembled
 * `declaration.v1` document validates, and the obligation takes it today. Then the reference is
 * allocated (first version only, gapless: a rollback returns the number), the immutable version
 * and its items are written encrypted, the previous version is superseded, the declaration is
 * submitted, the obligation filed, and the events recorded. The obligation's workflow is told
 * after commit; a lost signal is healed by the workflow reading the row. The `Idempotency-Key`
 * store (api-kit) replays a retried request; the key's hash is also kept on the version, so a
 * retry whose stored answer was lost still gets the same submission back rather than a conflict.
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
    const submitted = await withPerson(this.db, person, async (tx): Promise<Submitted> => {
      const declaration = notFoundIfInvisible(
        await liveDeclaration(tx, declarationId, { lock: true }),
      );
      // Only a draft or an amendment in progress, what can be edited, is submitted.
      if (!isEditable(declaration.status)) {
        const replayed = await this.replayed(tx, declaration, keyHash);
        if (replayed) return replayed;
        throw refused('not-a-draft');
      }
      const stepUp = requireFreshStepUp(principal, now, declaration.id);

      const rows = await liveSections(tx, declaration.id);
      const review = reviewDraft(
        documentFrame(declaration),
        await this.sections.openAll(declaration.tenant, rows),
        rows.map((row) => ({ key: row.sectionKey, completeness: row.completeness })),
      );
      if (!review.valid) throw incomplete(review.blocking);

      // The obligation, the version and its items are the Commission's data, which the declarant
      // only reads: the rest of the transaction writes them in its tenant's context (ADR-018),
      // the person's still set for the declaration itself.
      await switchTenant(tx, { tenant: declaration.tenant, subject: person.subject });
      const obligation = await obligationOf(tx, declaration, { lock: true });
      const refusal = obligationRefusal(declaration.status, obligation, today);
      if (refusal) throw refused(refusal);

      return this.record(tx, {
        declaration,
        obligation,
        // It validated against declaration.v1 just above.
        document: review.document as unknown as DeclarationV1,
        stepUp,
        now,
        late: isLate(obligation.dueDate, today),
        keyHash,
      });
    });

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

  /** Writes the version, its items and everything the legal act changes, in the transaction. */
  private async record(
    tx: Transaction,
    {
      declaration,
      obligation,
      document,
      stepUp,
      now,
      late,
      keyHash,
    }: {
      declaration: DeclarationRow;
      obligation: { id: string; status: ObligationStatus };
      document: DeclarationV1;
      stepUp: StepUp;
      now: Date;
      late: boolean;
      keyHash: string;
    },
  ): Promise<Submitted> {
    const { tenant } = declaration;
    const cycleYear = Number(declaration.statementDate.slice(0, 4));
    const versionId = uuidv7();
    const version = (declaration.currentVersion ?? 0) + 1;
    // Encrypted before the reference is allocated, so the counter stays locked for as short a
    // time as can be: concurrent submissions of the Commission and year queue behind it.
    const items = await this.sealItems(tenant, versionId, cycleYear, deriveItems(document));
    const reference =
      declaration.reference ??
      (await allocateReference(tx, declarationSchemes[declaration.type], {
        issuer: issuerCode(tenant),
        period: cycleYear,
      }));
    // The legal record carries its own reference and time (First Schedule note 11), and the hash
    // is of exactly the bytes that are encrypted.
    const record: DeclarationV1 = {
      ...document,
      attestation: { ...document.attestation, declaredAt: now.toISOString(), reference },
    };
    const canonical = canonicalJson(record);
    const snapshot = await this.cipher.encrypt({
      tenant,
      recordId: versionRecordId(versionId),
      plaintext: canonical,
    });

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
        snapshotCiphertext: Buffer.from(snapshot.ciphertext, 'base64'),
        envelope: snapshot.envelope,
        canonicalSha256: sha256(canonical),
        submittedAt: now,
        late,
        stepUpAcr: stepUp.acr,
        stepUpAuthTime: new Date(stepUp.authTime * 1000),
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
    return mapConcurrently(items, ENCRYPT_CONCURRENCY / 2, async (item) => {
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

/** The step-up a submission was made with: its evidence on the version. */
interface StepUp {
  acr: string;
  /** Seconds since the epoch. */
  authTime: number;
}

/**
 * The token's step-up, or 403 unless it was issued after a fresh one-time code (`acr` step-up) no
 * more than five minutes ago by the service's clock. An `auth_time` ahead of the clock (skew)
 * counts as fresh.
 */
function requireFreshStepUp(principal: Principal, now: Date, declarationId: string): StepUp {
  if (principal.acr !== STEP_UP_ACR || principal.authTime === null) {
    throw stepUpRequired(
      stepUpUrl(declarationId),
      'Confirm your identity with a one-time code before submitting.',
    );
  }
  if (now.getTime() / 1000 - principal.authTime > STEP_UP_MAX_AGE_SECONDS) {
    throw stepUpRequired(
      stepUpUrl(declarationId),
      'The one-time code was confirmed more than five minutes ago; confirm your identity again.',
    );
  }
  return { acr: principal.acr, authTime: principal.authTime };
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
