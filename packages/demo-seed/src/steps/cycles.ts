import { DEMO_COMMISSIONS } from '../data/commissions.js';
import { CURRENT_CYCLE, PREVIOUS_CYCLE } from '../data/personas.js';
import { EARLIER_CYCLE, REFERRAL_OFFICER } from '../data/review.js';
import { serviceScript } from '../repo.js';
import type { SeedStep } from '../step.js';

/**
 * The demo's statutory calendar. The first real biennial cycle (2027) has its statement date on
 * 1 November 2027, so nobody can file it before then (`before-statement-date`) and a demo held
 * now has nothing to file or compare. The demo runs two earlier cycles on the same rules instead,
 * as data, not clock changes:
 *
 * - every Commission's policy puts the biennial statement date on 30 June (due 31 December), so
 *   the demo cycles fall in financial year 2025/26, the year Form M is compiled for now;
 * - the cycle calendar gains 2024 (the previous declaration, closed) and 2026 (open, due
 *   31 December 2026: what Wanjiku files live, on time);
 * - the obligations-start date moves back to the 2024 statement date so the cycles reach every
 *   officer, and reminders add a 1-day offset so the reminder officer's goes out today;
 * - EACC, whose roster holds only the officer the demo refers after two missed cycles (#618),
 *   starts at the 2022 statement date, and the calendar gains 2022, so he has two to miss.
 *
 * No API changes these (the product changes the obligations-start date alone, spec 04): the
 * services' own demo scripts write them, refused in production.
 */
export const DEMO_POLICY = {
  biennial: { statementDate: '06-30', dueDate: '12-31' },
  obligationsStartDate: `${String(PREVIOUS_CYCLE)}-06-30`,
  reminderOffsetsDays: [30, 14, 7, 1],
} as const;

/** A Commission's obligations-start date: EACC's reaches back one more cycle. */
export function obligationsStartDate(slug: string): string {
  return slug === REFERRAL_OFFICER.commission
    ? `${String(EARLIER_CYCLE)}-06-30`
    : DEMO_POLICY.obligationsStartDate;
}

/** Lead days that have opened every demo cycle (2022 opened in 2021, 2026 in 2025). */
const OPENING_LEAD_DAYS = 400;

export const policies: SeedStep = {
  id: 'policies',
  title: 'Demo policy: biennial statement date, obligations start, reminder offsets',
  async run() {
    let changed = 0;
    for (const commission of DEMO_COMMISSIONS) {
      const outcome = await serviceScript('@adili/directory', 'demo:policy', [
        JSON.stringify({
          tenant: commission.slug,
          biennial: DEMO_POLICY.biennial,
          obligationsStartDate: obligationsStartDate(commission.slug),
          reminderOffsetsDays: DEMO_POLICY.reminderOffsetsDays,
        }),
      ]);
      if (outcome === 'changed') changed++;
    }
    return { changed };
  },
};

export const cycles: SeedStep = {
  id: 'cycles',
  title: `Demo cycles ${String(EARLIER_CYCLE)}, ${String(PREVIOUS_CYCLE)} and ${String(CURRENT_CYCLE)} open`,
  async run() {
    const outcome = await serviceScript('@adili/declarations', 'demo:cycles', [
      `${String(EARLIER_CYCLE)},${String(PREVIOUS_CYCLE)},${String(CURRENT_CYCLE)}`,
      String(OPENING_LEAD_DAYS),
    ]);
    return { changed: outcome === 'changed' ? 1 : 0 };
  },
};
