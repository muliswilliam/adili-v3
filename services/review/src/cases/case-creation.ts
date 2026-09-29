import { type Database, withTenant } from '@adili/data-access';
import type { EventPublisher } from '@adili/events';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { ReviewSchema } from '../db/schema.js';
import type { UpsertCaseOutcome, UpsertCaseRequest } from '../processing/contract.js';
import { band, score } from '../rules/index.js';
import { SYSTEM_SUBJECT, systemContext } from '../system-context.js';
import { type CaseProcessedData, REVIEW_CASE_CREATED } from './events.js';
import { reviewCases, reviewFlags, reviewTimeline } from './schema.js';

/**
 * Creates the review case of a submitted version, idempotently by declaration and version: in one
 * transaction the case (`unassigned`, with its score, band and clarification window), its flags,
 * a timeline entry and `review.case.created.v1`. A declaration that already has a case is left as
 * it is: `unchanged` when the case is at this version or a later one (a redelivery or a retried
 * run), `amendment` when this is a later version, which the amendment path processes.
 *
 * Receipt (Act s.35(2)) is the submission of the version that created the case, normally
 * version 1; the window ends `issueWindowMonths` after it.
 */
export async function createCase(
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
      const [existing] = await tx
        .select({ id: reviewCases.id, currentVersion: reviewCases.currentVersion })
        .from(reviewCases)
        .where(eq(reviewCases.declarationId, input.declarationId));
      if (!existing) throw new Error(`The case of ${input.declarationId} is not visible`);
      return existing.currentVersion >= input.version
        ? { outcome: 'unchanged', caseId: existing.id }
        : { outcome: 'amendment', caseId: existing.id };
    }

    if (flags.length > 0) {
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
