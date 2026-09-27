const PARTS = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Africa/Nairobi',
});

// Built from parts so the server and every browser print the same text (en-GB spells September
// "Sept" in newer ICU data).
function parts(iso: string) {
  const all = PARTS.formatToParts(new Date(iso));
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
