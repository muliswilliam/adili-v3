const DAY_MONTH_YEAR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** Days in a month, where `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Reads `DD/MM/YYYY` (single-digit day and month allowed) into an ISO date `YYYY-MM-DD`.
 * Returns null for any other format or an impossible date such as 31/02/2026.
 */
export function parseDayMonthYear(text: string): string | null {
  const match = DAY_MONTH_YEAR.exec(text.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** ISO date `2026-09-05` → `05/09/2026`. */
export function formatDayMonthYear(iso: string): string {
  const [year = '', month = '', day = ''] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Reshapes text as it is typed into a date field: keeps digits and slashes, adds the slash after
 * the day and the month while inserting (not while deleting), and stops at ten characters.
 */
export function shapeDateText(raw: string, inserting: boolean): string {
  let text = raw.replace(/[^\d/]/g, '').replace(/\/{2,}/g, '/');
  if (!text.includes('/') && text.length > 2) {
    text = [text.slice(0, 2), text.slice(2, 4), text.slice(4, 8)].filter(Boolean).join('/');
  }
  if (inserting && (/^\d{2}$/.test(text) || /^\d{1,2}\/\d{2}$/.test(text))) text += '/';
  return text.slice(0, 10);
}
