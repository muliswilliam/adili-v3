import type { Database } from '@adili/data-access';
import { and, eq, lt } from 'drizzle-orm';

import type { DeclarationsSchema } from '../db/schema.js';
import { nairobiDate } from './dates.js';
import { cycleCalendar } from './schema.js';

/** The cycle the demo shows: its statement date is 1 November 2027. */
const DEMO_CYCLE = { cycleYear: 2027, statementDate: '2027-11-01' };

/**
 * Opens the 2027 cycle from today for the demo, so a declarant sees their biennial 2027
 * obligation before 4 July 2027 (when it opens with the seeded 120 days). The cycle calendar is
 * platform data (spec 04): this widens the cycle's opening lead, and never narrows it. Idempotent.
 */
export async function openDemoCycle(db: Database<DeclarationsSchema>, now: Date): Promise<void> {
  const days = daysBetween(nairobiDate(now), DEMO_CYCLE.statementDate);
  await db
    .update(cycleCalendar)
    .set({ openingLeadDays: days })
    .where(
      and(
        eq(cycleCalendar.cycleYear, DEMO_CYCLE.cycleYear),
        lt(cycleCalendar.openingLeadDays, days),
      ),
    );
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
