/**
 * Calendar-day arithmetic in Kenyan time, like `formatDate`: deadlines and periods (a 30-day
 * response period, a day-20 reminder) are counted in days as people read them on a calendar in
 * Nairobi, not in 24-hour spans.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Nairobi is UTC+3 all year. */
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

function dayNumber(iso: string): number {
  return Math.floor((Date.parse(iso) + NAIROBI_OFFSET_MS) / DAY_MS);
}

/** Calendar days from `from` to `to` in Kenyan time; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** Midnight in Nairobi at the start of the Kenyan calendar day of `instant`, as an ISO string. */
export function nairobiDayStartOf(instant: string): string {
  return new Date(dayNumber(instant) * DAY_MS - NAIROBI_OFFSET_MS).toISOString();
}

/** The instant `days` whole days after (or before) `iso`, as an ISO string. */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

/** `1 day`, `3 days`: a count and a regular English noun. */
export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
