import type { OfficerCategory } from '../../server/directory/types';

/** Dates are shown in Kenyan time so the server render and the browser agree. */
const TIME_ZONE = 'Africa/Nairobi';

const absolute = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: TIME_ZONE,
});

const dateOnly = new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeZone: TIME_ZONE });

/** The calendar day in Kenya, as `YYYY-MM-DD`. */
const calendarDay = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });

const numbers = new Intl.NumberFormat('en-KE');

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatNumber(value: number): string {
  return numbers.format(value);
}

export function formatDateTime(iso: string): string {
  return absolute.format(new Date(iso));
}

export function formatDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}

/**
 * How long ago, in whole Kenyan calendar days as the prototype words it: "today", "yesterday",
 * "12 days ago", then months of 30 days from day 31.
 */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const days = Math.round(
    (Date.parse(calendarDay.format(now)) - Date.parse(calendarDay.format(new Date(iso)))) / DAY_MS,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? '1 month ago' : `${months} months ago`;
}

/** The first citations to show inline, and the rest for a "+N" chip. */
export function summariseCategories(
  categories: readonly OfficerCategory[],
  shown = 2,
): { visible: OfficerCategory[]; hidden: OfficerCategory[] } {
  return { visible: categories.slice(0, shown), hidden: categories.slice(shown) };
}
