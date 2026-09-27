const PARTS = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Africa/Nairobi',
});

/**
 * `2026-09-26T07:42:00Z` → `26 Sep 2026, 10:42`, in Kenyan time. Built from parts so the server
 * and every browser print the same text.
 */
export function formatDateTime(iso: string): string {
  const parts = PARTS.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')}`;
}
