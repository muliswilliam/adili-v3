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
