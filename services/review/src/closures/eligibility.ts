import { and, eq, isNull, lte, notExists, notInArray, type SQL, sql } from 'drizzle-orm';

import { type CaseStatus, reviewCases } from '../cases/schema.js';
import { determinations } from '../determinations/schema.js';

/**
 * Cases the sweep leaves alone whatever else holds: determined (closed), kept open for further
 * action, or already diverted to review.
 */
const SETTLED: readonly CaseStatus[] = ['determined', 'further-action', 'sample-review'];

/**
 * The cases the closure sweep may propose for closure or divert to review at `now` (spec 08):
 * band `low`, their clarification window passed, no open flag (none, or all reviewed), no open
 * clarification, never sampled and no determination of any status. Whether a reviewer holds the
 * case does not matter; a case already determined, kept for further action or in sample review is
 * never swept.
 */
export function eligibleForClosure(now: Date): SQL | undefined {
  return and(
    eq(reviewCases.band, 'low'),
    notInArray(reviewCases.status, [...SETTLED]),
    lte(reviewCases.windowEndsAt, now),
    eq(reviewCases.openFlags, 0),
    eq(reviewCases.openClarifications, 0),
    isNull(reviewCases.sampledAt),
    notExists(
      sql`(select 1 from ${determinations} where ${determinations.caseId} = ${reviewCases.id})`,
    ),
  );
}
