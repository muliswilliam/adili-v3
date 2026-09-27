/**
 * Dates as the console shows them, in Kenyan time. Built from numeric parts rather than
 * locale month names so the server-rendered and hydrated text agree across ICU versions and
 * machine time zones.
 */
const TIME_ZONE = 'Africa/Nairobi';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 60 * 60 * 1000;

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TIME_ZONE,
});

const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

interface KenyanParts {
  day: number;
  month: number;
  year: number;
  hour: string;
  minute: string;
}

function kenyanParts(date: Date): KenyanParts {
  const parts = Object.fromEntries(
    partsFormat.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    day: Number(parts.day),
    month: Number(parts.month),
    year: Number(parts.year),
    hour: parts.hour ?? '00',
    minute: parts.minute ?? '00',
  };
}

/** `21 Sep 2026` */
export function formatDate(iso: string): string {
  const { day, month, year } = kenyanParts(new Date(iso));
  return `${day} ${MONTHS[month - 1] ?? ''} ${year}`;
}

/** `21 Sep 2026, 12:40` */
export function formatDateTime(iso: string): string {
  const { hour, minute } = kenyanParts(new Date(iso));
  return `${formatDate(iso)}, ${hour}:${minute}`;
}

/** `today`, `yesterday`, `5 days ago`, `2 months ago`, `last year`. */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const days = Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / DAY_MS);
  if (Math.abs(days) < 30) return relativeFormat.format(days, 'day');
  const months = Math.round(days / 30.44);
  if (Math.abs(months) < 12) return relativeFormat.format(months, 'month');
  return relativeFormat.format(Math.round(days / 365.25), 'year');
}

/** Midnight of the Kenyan calendar day, as epoch milliseconds. */
function startOfDay(date: Date): number {
  const { day, month, year } = kenyanParts(date);
  return Date.UTC(year, month - 1, day);
}
