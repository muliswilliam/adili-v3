import { daysBetween } from './calendar-days';

const PARTS = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Africa/Nairobi',
});

const NUMERIC_PARTS = new Intl.DateTimeFormat('en', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Africa/Nairobi',
});

const LONG_PARTS = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Africa/Nairobi',
});

const MONTH_PARTS = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Africa/Nairobi',
});

// Built from parts so the server and every browser print the same text (en-GB spells September
// "Sept" in newer ICU data).
function parts(time: string | number, format = PARTS) {
  const all = format.formatToParts(new Date(time));
  return (type: Intl.DateTimeFormatPartTypes) =>
    all.find((entry) => entry.type === type)?.value ?? '';
}

/** `2026-09-26T07:42:00Z` → `26 Sep 2026`, in Kenyan time. */
export function formatDate(iso: string): string {
  const part = parts(iso);
  return `${part('day')} ${part('month')} ${part('year')}`;
}

/** `2027-11-01` → `1 November 2027`, in Kenyan time. */
export function formatLongDate(iso: string): string {
  const part = parts(iso, LONG_PARTS);
  return `${part('day')} ${part('month')} ${part('year')}`;
}

/** `2026-09-26T07:42:00Z` → `26 Sep 2026, 10:42`, in Kenyan time. */
export function formatDateTime(iso: string): string {
  const part = parts(iso);
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')}`;
}

/** `2026-03-11T21:05:00Z` → `2026-03-12`, the calendar date in Kenyan time. */
export function formatCalendarDate(time: string | number): string {
  const part = parts(time, NUMERIC_PARTS);
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** `2026-09-26T07:42:00Z` → `September 2026`, in Kenyan time. */
export function formatMonth(iso: string): string {
  const part = parts(iso, MONTH_PARTS);
  return `${part('month')} ${part('year')}`;
}

const DAY_MS = 86_400_000;
// Kenya keeps UTC+3 all year, so its midnight is a fixed offset from UTC.
const KENYA_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Whole calendar days in Kenyan time from `now` (epoch ms) to the day of `iso` (a date or a
 * date-time): 0 on the day itself, negative once it has passed (`daysBetween` from now).
 */
export function calendarDaysUntil(iso: string, now: number): number {
  return daysBetween(new Date(now).toISOString(), iso);
}

/** Milliseconds from `now` (epoch ms) to the next midnight in Kenyan time. */
export function msUntilKenyanMidnight(now: number): number {
  return DAY_MS - ((now + KENYA_OFFSET_MS) % DAY_MS);
}
