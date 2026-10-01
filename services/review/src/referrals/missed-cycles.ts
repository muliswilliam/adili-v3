import type { PersonObligation } from '../declarations/declarations-client.js';
import type { LadderPolicy } from '../directory/directory-client.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Biennial cycles fall two years apart. */
const BIENNIAL_YEARS = 2;

/** Two consecutive missed biennial cycles: the later one's year and both obligations. */
export interface MissedCycles {
  cycleYear: number;
  earlierCycleYear: number;
  /** The earlier obligation, then the later. */
  obligationIds: [string, string];
}

/**
 * How long the enforcement ladder runs before a referral is owed (spec 08): the notice's, the
 * warning's and the salary stoppage's windows together.
 */
export function ladderWindowDays(policy: LadderPolicy): number {
  return policy.noticeWindowDays + policy.warningWindowDays + policy.stoppageWindowDays;
}

/**
 * Whether a person's obligation history shows two consecutive biennial cycles overdue and unfiled
 * after the ladder window (spec 08 S12, Regs r.20(2)): of the person's biennial obligations that
 * were not cancelled, in cycle order, the latest pair of consecutive cycles (two years apart) both
 * `overdue` with nothing filed, the later one's due date more than `windowDays` before `today` (a
 * Nairobi date, `YYYY-MM-DD`). Null when there is none.
 */
export function twoMissedCycles(
  history: readonly PersonObligation[],
  today: string,
  windowDays: number,
): MissedCycles | null {
  const cycles = history
    .filter((entry) => entry.type === 'biennial' && entry.status !== 'cancelled')
    .map((entry) => ({ entry, year: cycleYearOf(entry.cycleKey) }))
    .filter((cycle): cycle is { entry: PersonObligation; year: number } => cycle.year !== null)
    .sort((a, b) => a.year - b.year);
  for (let index = cycles.length - 1; index > 0; index -= 1) {
    const later = cycles[index];
    const earlier = cycles[index - 1];
    if (!later || !earlier) continue;
    if (later.year - earlier.year !== BIENNIAL_YEARS) continue;
    if (!missed(earlier.entry) || !missed(later.entry)) continue;
    if (!pastWindow(later.entry.dueDate, today, windowDays)) continue;
    return {
      cycleYear: later.year,
      earlierCycleYear: earlier.year,
      obligationIds: [earlier.entry.obligationId, later.entry.obligationId],
    };
  }
  return null;
}

function missed(entry: PersonObligation): boolean {
  return entry.status === 'overdue' && entry.filedAt === null;
}

/** Whether `today` is after the due date plus the window. */
function pastWindow(dueDate: string, today: string, windowDays: number): boolean {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  return now - due > windowDays * DAY_MS;
}

/** The year of `biennial:<year>`; null for any other key. */
export function cycleYearOf(cycleKey: string): number | null {
  const match = /^biennial:(\d{4})$/.exec(cycleKey);
  return match?.[1] === undefined ? null : Number(match[1]);
}
