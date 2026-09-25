import type { OfficerCategory } from '../../server/directory/types';

/** Dates are shown in Kenyan time so the server render and the browser agree. */
const TIME_ZONE = 'Africa/Nairobi';

const absolute = new Intl.DateTimeFormat('en-KE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: TIME_ZONE,
});

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

export function formatDateTime(iso: string): string {
  return absolute.format(new Date(iso));
}

/** "3 days ago", "last week"; anything under a minute is "just now". */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const seconds = (new Date(iso).getTime() - now.getTime()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** The first citations to show inline, and the rest for a "+N" summary. */
export function summariseCategories(
  categories: readonly OfficerCategory[],
  shown = 2,
): { visible: string[]; hidden: string[] } {
  const citations = categories.map((category) => category.citation);
  return { visible: citations.slice(0, shown), hidden: citations.slice(shown) };
}
