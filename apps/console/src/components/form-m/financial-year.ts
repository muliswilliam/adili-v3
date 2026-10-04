/**
 * Financial years as Form M counts them (Regs r.25(2)): 1 July to 30 June, keyed by the start
 * year, so 2027 runs from 1 July 2027 to 30 June 2028. Its report is due on 31 July 2028; a
 * preview can be compiled from 1 April 2028 and the scheduled compile makes the final draft on
 * 1 July 2028. Days are `YYYY-MM-DD` in Nairobi. The reporting service holds the same rules
 * (`services/reporting/src/financial-year.ts`); the console only reads them.
 */
import { addDays } from '@adili/ui';

/** The first financial year reports exist for (reporting.yaml `FinancialYear`). */
export const FIRST_FINANCIAL_YEAR = 2025;

/** The financial year (start year) a Nairobi day falls in. */
export function financialYearOf(day: string): number {
  const year = Number(day.slice(0, 4));
  return Number(day.slice(5, 7)) >= 7 ? year : year - 1;
}

/** The last day of the financial year: 30 June after it starts. */
export const yearEndOf = (fy: number) => `${String(fy + 1)}-06-30`;

/** The day the report is due at EACC: 31 July after the year. */
export const dueDateOf = (fy: number) => `${String(fy + 1)}-07-31`;

/** The first day a supervisor may compile a preview: 1 April of the year's last quarter. */
export const previewFromOf = (fy: number) => `${String(fy + 1)}-04-01`;

/** The day the scheduled compile makes the final draft: 1 July after the year. */
export const finalCompileOf = (fy: number) => `${String(fy + 1)}-07-01`;

/** The Nairobi day (`YYYY-MM-DD`) of an instant. */
export const nairobiDayOf = (iso: string) => nairobiToday(new Date(iso));

/** The day `days` after `day` (`YYYY-MM-DD`), counted on the calendar. */
export const dayAfter = (day: string, days: number) => addDays(day, days).slice(0, 10);

/** Today in Nairobi, as `YYYY-MM-DD`. */
export function nairobiToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(now);
}
