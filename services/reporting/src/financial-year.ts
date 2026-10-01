import { nairobiDate } from './clock.js';

/**
 * Financial years (Regs r.25(2)): 1 July to 30 June, keyed by the start year, so 2027 is 1 July
 * 2027 to 30 June 2028. Form M for it is due on 31 July 2028; a preview can be compiled from
 * 1 April 2028 and the final draft on 1 July 2028.
 */

/** The financial year a calendar date (`YYYY-MM-DD`) falls in. */
export function financialYearOf(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= 7 ? year : year - 1;
}

/** The financial year an instant falls in, by its date in Nairobi. */
export function financialYearAt(instant: Date): number {
  return financialYearOf(nairobiDate(instant));
}

/** How a financial year reads to people: `2027/2028`. */
export function fyLabel(fy: number): string {
  return `${String(fy)}/${String(fy + 1)}`;
}

/** The period Form M reports on: Part I `period`. */
export function periodOf(fy: number): { from: string; to: string; financialYearStart: number } {
  return { from: `${String(fy)}-07-01`, to: `${String(fy + 1)}-06-30`, financialYearStart: fy };
}

/**
 * The period a report reference carries for the year (ADR-011 §2): the financial year's end, so
 * FY 2027/2028 numbers `RPT-PSC-2028-...`.
 */
export function referencePeriodOf(fy: number): number {
  return fy + 1;
}

/** The date Form M for the year is due at EACC (Regs r.25(2)). */
export function dueDateOf(fy: number): string {
  return `${String(fy + 1)}-07-31`;
}

/** The first day a supervisor may compile a preview of the year's report. */
export function previewFromOf(fy: number): string {
  return `${String(fy + 1)}-04-01`;
}

/** The first financial year reports exist for (reporting.yaml `FinancialYear` minimum). */
export const FIRST_FINANCIAL_YEAR = 2025;
