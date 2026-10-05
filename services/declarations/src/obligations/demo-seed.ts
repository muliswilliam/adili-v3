import type { Database } from '@adili/data-access';
import { and, eq, lt, sql } from 'drizzle-orm';

import type { DeclarationsSchema } from '../db/schema.js';
import { daysBetween, nairobiDate } from './dates.js';
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

/**
 * The demo seed's cycles (#617): adds each year to the cycle calendar with `openingLeadDays`, or
 * widens a shorter lead, so the cycles are open today. With the demo policy's biennial month-days
 * (directory `demo:policy`) their statement dates have passed: the earlier cycle is the
 * declarants' previous declaration, the later one the declaration they file in the demo. The
 * calendar is platform data with no API (spec 04). Returns the years it changed.
 */
export async function addDemoCycles(
  db: Database<DeclarationsSchema>,
  years: readonly number[],
  openingLeadDays: number,
): Promise<number[]> {
  const changed = await db
    .insert(cycleCalendar)
    .values(years.map((cycleYear) => ({ cycleYear, openingLeadDays })))
    .onConflictDoUpdate({
      target: cycleCalendar.cycleYear,
      set: { openingLeadDays: sql`excluded.opening_lead_days` },
      setWhere: lt(cycleCalendar.openingLeadDays, openingLeadDays),
    })
    .returning({ cycleYear: cycleCalendar.cycleYear });
  return changed.map((row) => row.cycleYear);
}
