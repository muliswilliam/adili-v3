/**
 * Civil (calendar) dates as `YYYY-MM-DD` strings: the shape statement and due dates have in the
 * contract and in Postgres `date` columns. Arithmetic runs on UTC midnights so month ends, leap
 * days and year boundaries come out as a calendar would, with no time zone drift.
 */

/** A calendar date, `YYYY-MM-DD`. */
export type CivilDate = string;

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_DAY = /^(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Splits a civil date, refusing ones the calendar lacks (2027-02-29, 2027-13-01). */
export function parseCivilDate(date: CivilDate): { year: number; month: number; day: number } {
  const match = CIVIL_DATE.exec(date);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (
      utc.getUTCFullYear() === year &&
      utc.getUTCMonth() === month - 1 &&
      utc.getUTCDate() === day
    ) {
      return { year, month, day };
    }
  }
  throw new RangeError(`Not a calendar date: ${date}`);
}

function toUtc(date: CivilDate): number {
  const { year, month, day } = parseCivilDate(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms: number): CivilDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The date `days` calendar days after `date` (before it when negative). */
export function addDays(date: CivilDate, days: number): CivilDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Calendar days from `from` to `to`: negative when `to` is earlier. */
export function daysBetween(from: CivilDate, to: CivilDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** A policy month-day (`11-01`) in a given year. */
export function atMonthDay(year: number, monthDay: string): CivilDate {
  const match = MONTH_DAY.exec(monthDay);
  if (!match) throw new RangeError(`Not a month-day: ${monthDay}`);
  const date = `${String(year).padStart(4, '0')}-${match[1] ?? ''}-${match[2] ?? ''}`;
  parseCivilDate(date);
  return date;
}

/** Today's date in Kenya (Africa/Nairobi), which the statutory periods are counted in. */
export function nairobiDate(now: Date): CivilDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
