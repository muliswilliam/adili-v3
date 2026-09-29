import { type Database, withTenant } from '@adili/data-access';
import type { EventPublisher } from '@adili/events';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ReviewSchema } from '../db/schema.js';
import type {
  ProcessingInput,
  UpsertCaseOutcome,
  UpsertCaseRequest,
} from '../processing/contract.js';
import { band, type Flag, score } from '../rules/index.js';
import { SYSTEM_SUBJECT, systemContext } from '../system-context.js';
import { type CaseProcessedData, REVIEW_CASE_CREATED, REVIEW_CASE_UPDATED } from './events.js';
import { reviewCases, reviewFlags, reviewTimeline } from './schema.js';

type Transaction = Parameters<Parameters<Database<ReviewSchema>['transaction']>[0]>[0];

/**
 * Creates or updates the review case of a submitted version, idempotently by declaration and
 * version. Version 1 (or the first version processed) creates the case in one transaction: the
 * case (`unassigned`, with its score, band and clarification window), its flags, a timeline entry
 * and `review.case.created.v1`. A later version updates it (`updated`, see `amendCase`). A version
 * the case is already at, or past, changes nothing (`unchanged`: a redelivery, a retried run or
 * an out-of-order one).
 *
 * Receipt (Act s.35(2)) is the submission of the version that created the case, normally
 * version 1; the window ends `issueWindowMonths` after it. An amendment moves neither.
 */
export async function upsertCase(
  db: Database<ReviewSchema>,
  events: EventPublisher,
  { input, facts, flags }: UpsertCaseRequest,
  issueWindowMonths: number,
): Promise<UpsertCaseOutcome> {
  return withTenant(db, systemContext(input.tenant), async (tx) => {
    const caseId = uuidv7();
    const receivedAt = new Date(facts.submittedAt);
    const caseScore = score(flags);
    const caseBand = band(caseScore);
    const [created] = await tx
      .insert(reviewCases)
      .values({
        id: caseId,
        tenant: input.tenant,
        declarationId: input.declarationId,
        currentVersionId: input.versionId,
        currentVersion: input.version,
        personId: facts.personId,
        reference: facts.reference,
        type: facts.type,
        statementDate: facts.statementDate,
        cycleYear: Number(facts.statementDate.slice(0, 4)),
        receivedAt,
        windowEndsAt: addMonths(receivedAt, issueWindowMonths),
        late: facts.late,
        score: caseScore,
        band: caseBand,
        status: 'unassigned',
        declarantName: facts.declarantName,
        personnelFileNumber: facts.personnelFileNumber,
        openFlags: flags.length,
      })
      .onConflictDoNothing({ target: reviewCases.declarationId })
      .returning({ id: reviewCases.id });

    if (!created) {
      // Locked, so two versions processed at once apply in turn.
      const [existing] = await tx
        .select({ id: reviewCases.id, currentVersion: reviewCases.currentVersion })
        .from(reviewCases)
        .where(eq(reviewCases.declarationId, input.declarationId))
        .for('update');
      if (!existing) throw new Error(`The case of ${input.declarationId} is not visible`);
      if (existing.currentVersion >= input.version) {
        return { outcome: 'unchanged', caseId: existing.id };
      }
      await amendCase(tx, events, { input, facts, flags }, existing.id);
      return { outcome: 'updated', caseId: existing.id };
    }

    await insertFlags(tx, input, caseId, flags);
    await tx.insert(reviewTimeline).values({
      id: uuidv7(),
      tenant: input.tenant,
      caseId,
      kind: 'case-created',
      ref: input.versionId,
      actor: SYSTEM_SUBJECT,
      summary: `Case created from version ${String(input.version)} with ${String(flags.length)} flags`,
    });
    await events.record<CaseProcessedData>(tx, {
      type: REVIEW_CASE_CREATED,
      subject: caseId,
      tenant: input.tenant,
      data: {
        caseId,
        declarationId: input.declarationId,
        versionId: input.versionId,
        band: caseBand,
      },
    });
    return { outcome: 'created', caseId };
  });
}

/**
 * The amendment path: a later version of a declaration whose case exists. In the caller's
 * transaction the case moves to the version, its unreviewed flags are replaced by the version's,
 * reviewed flags are kept (with their note and version) marked `recomputed`, the score, band and
 * open-flag count follow the new flags, and a timeline entry and `review.case.updated.v1` record
 * it. Status, assignee, receipt, lateness and the clarification window are left as they are: they
 * are version 1's (Act s.35(2)), and an amendment never resets them.
 */
async function amendCase(
  tx: Transaction,
  events: EventPublisher,
  { input, facts, flags }: UpsertCaseRequest,
  caseId: string,
): Promise<void> {
  const kept = await tx
    .update(reviewFlags)
    .set({ recomputed: true })
    .where(and(eq(reviewFlags.caseId, caseId), isNotNull(reviewFlags.reviewedAt)))
    .returning({ id: reviewFlags.id });
  await tx
    .delete(reviewFlags)
    .where(and(eq(reviewFlags.caseId, caseId), isNull(reviewFlags.reviewedAt)));
  await insertFlags(tx, input, caseId, flags);

  const caseScore = score(flags);
  const caseBand = band(caseScore);
  await tx
    .update(reviewCases)
    .set({
      currentVersionId: input.versionId,
      currentVersion: input.version,
      score: caseScore,
      band: caseBand,
      openFlags: flags.length,
      declarantName: facts.declarantName,
      personnelFileNumber: facts.personnelFileNumber,
    })
    .where(eq(reviewCases.id, caseId));
  await tx.insert(reviewTimeline).values({
    id: uuidv7(),
    tenant: input.tenant,
    caseId,
    kind: 'version-processed',
    ref: input.versionId,
    actor: SYSTEM_SUBJECT,
    summary: `Version ${String(input.version)} processed: ${plural(flags.length, 'flag')} raised, ${plural(kept.length, 'reviewed flag')} kept as recomputed`,
  });
  await events.record<CaseProcessedData>(tx, {
    type: REVIEW_CASE_UPDATED,
    subject: caseId,
    tenant: input.tenant,
    data: {
      caseId,
      declarationId: input.declarationId,
      versionId: input.versionId,
      band: caseBand,
    },
  });
}

/** The flags a version raised, on the case. */
async function insertFlags(
  tx: Transaction,
  input: ProcessingInput,
  caseId: string,
  flags: Flag[],
): Promise<void> {
  if (flags.length === 0) return;
  await tx.insert(reviewFlags).values(
    flags.map((flag) => ({
      id: uuidv7(),
      tenant: input.tenant,
      caseId,
      versionId: input.versionId,
      ruleId: flag.ruleId,
      severity: flag.severity,
      title: flag.title,
      indicator: flag.indicator,
      evidence: flag.evidence,
      itemRefs: flag.itemRefs,
    })),
  );
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** `months` calendar months after `instant` (UTC), on the last day of a shorter month. */
export function addMonths(instant: Date, months: number): Date {
  const result = new Date(instant);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}
