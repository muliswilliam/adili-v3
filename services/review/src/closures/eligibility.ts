import { and, eq, isNull, lte, notExists, type SQL, sql } from 'drizzle-orm';

import { reviewCases } from '../cases/schema.js';
import { determinations } from '../determinations/schema.js';

/**
 * The cases the closure sweep may propose for closure or divert to review at `now` (spec 08):
 * band `low`, still unassigned in the queue, their clarification window passed, no open flag (none
 * or all reviewed), no open clarification, never sampled and no determination of any status.
 */
export function eligibleForClosure(now: Date): SQL | undefined {
  return and(
    eq(reviewCases.band, 'low'),
    eq(reviewCases.status, 'unassigned'),
    lte(reviewCases.windowEndsAt, now),
    eq(reviewCases.openFlags, 0),
    eq(reviewCases.openClarifications, 0),
    isNull(reviewCases.sampledAt),
    notExists(
      sql`(select 1 from ${determinations} where ${determinations.caseId} = ${reviewCases.id})`,
    ),
  );
}
