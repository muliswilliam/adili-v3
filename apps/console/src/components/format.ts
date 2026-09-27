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

/**
 * How long ago, in Kenyan calendar days as the prototype words it: `today`, `yesterday`,
 * `12 days ago`, then months of 30 days from day 31 (`1 month ago`), then years.
 */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return months <= 1 ? '1 month ago' : `${months} months ago`;
  const years = Math.round(days / 365.25);
  return years <= 1 ? '1 year ago' : `${years} years ago`;
}

/**
 * How long ago, to the minute within a day as the prototype words it (`just now`,
 * `12 minutes ago`, `4 hours ago`), then as `formatRelativeDate`. For recent activity such as a
 * credential's last use.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  return formatRelativeDate(iso, now);
}

const numberFormat = new Intl.NumberFormat('en-KE');

/** `48,312` */
export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

const MEBIBYTE = 1024 * 1024;

/**
 * `4.3 MB`, `12 KB`: binary units as upload limits count them. Rounded up, so a file just over
 * a limit never reads as the limit itself ("50.1 MB", not "50.0 MB").
 */
export function formatFileSize(bytes: number): string {
  // The epsilon keeps float noise (4.3 MiB is 43.000000001 tenths) from rounding up a tenth.
  if (bytes >= MEBIBYTE) return `${(Math.ceil((bytes / MEBIBYTE) * 10 - 1e-9) / 10).toFixed(1)} MB`;
  return `${formatNumber(Math.max(1, Math.ceil(bytes / 1024)))} KB`;
}

/** Midnight of the Kenyan calendar day, as epoch milliseconds. */
function startOfDay(date: Date): number {
  const { day, month, year } = kenyanParts(date);
  return Date.UTC(year, month - 1, day);
}
