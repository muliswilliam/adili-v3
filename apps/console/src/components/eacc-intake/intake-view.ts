import { addDays, daysBetween } from '@adili/ui';

import type { Intake, IntakeRow, IntakeStatus } from '../../server/reporting/types';
import { nairobiDay } from '../access/request-view';
import { dueDateOf, FIRST_FINANCIAL_YEAR, financialYearOf } from '../form-m/financial-year';

/**
 * The EACC intake dashboard's rules (spec 09 FE-3), apart from rendering: which financial years
 * it offers, how its filters narrow the year's Commissions, and what the chase and deadline
 * lines say. Days are `YYYY-MM-DD` in Nairobi.
 */

export interface FinancialYearOption {
  fy: number;
  /** Today falls in it: its reports are not due yet. */
  current: boolean;
  dueDate: string;
}

/** Every year since the first, newest first. */
export function financialYears(today: string): FinancialYearOption[] {
  const current = Math.max(financialYearOf(today), FIRST_FINANCIAL_YEAR);
  const years: FinancialYearOption[] = [];
  for (let fy = current; fy >= FIRST_FINANCIAL_YEAR; fy -= 1) {
    years.push({ fy, current: fy === financialYearOf(today), dueDate: dueDateOf(fy) });
  }
  return years;
}

/**
 * The year the intake opens on: the last one that ended, whose reports are due or in; the
 * current one while none has ended since the platform started.
 */
export function defaultFinancialYear(today: string): number {
  return Math.max(financialYearOf(today) - 1, FIRST_FINANCIAL_YEAR);
}

export interface IntakeFilters {
  status?: IntakeStatus;
  /** Only Commissions with an outlier. */
  outliers?: boolean;
  /** Matches the Commission's name or the report's reference, any case. */
  q?: string;
}

/** The Commissions the filters keep, in the service's order (by name). */
export function filterIntake(rows: readonly IntakeRow[], filters: IntakeFilters): IntakeRow[] {
  const q = filters.q?.trim().toLowerCase() ?? '';
  return rows.filter(
    (row) =>
      (!filters.status || row.status === filters.status) &&
      (!filters.outliers || row.outliers.length > 0) &&
      (!q ||
        row.commission.name.toLowerCase().includes(q) ||
        (row.reference?.toLowerCase().includes(q) ?? false)),
  );
}

export type IntakeCounts = Record<'all' | IntakeStatus | 'outliers', number>;

/** How many Commissions each filter chip stands for, over the whole year. */
export function intakeCounts(rows: readonly IntakeRow[]): IntakeCounts {
  const count = (keep: (row: IntakeRow) => boolean) => rows.filter(keep).length;
  return {
    all: rows.length,
    'submitted-on-time': count((row) => row.status === 'submitted-on-time'),
    'submitted-late': count((row) => row.status === 'submitted-late'),
    'not-reported': count((row) => row.status === 'not-reported'),
    outliers: count((row) => row.outliers.length > 0),
  };
}

/**
 * The day of EACC's next weekly chase: a week after the latest round, while a Commission has not
 * reported and that day has not passed (a chase that stopped, e.g. once the national report was
 * approved, has none). Null before the first round, which the service starts on 1 August.
 */
export function nextChaseOn(intake: Intake, today: string): string | null {
  const last = intake.commissions
    .filter((row) => row.status === 'not-reported')
    .flatMap((row) => (row.chases.lastAt ? [nairobiDay(row.chases.lastAt)] : []))
    .sort()
    .at(-1);
  if (!last) return null;
  const next = addDays(last, 7).slice(0, 10);
  return next >= today ? next : null;
}

/** No report is in for the year and it is not due yet: nothing to read or chase. */
export function awaitingReports(intake: Intake, today: string): boolean {
  const { onTime, late } = intake.totals;
  return onTime + late === 0 && today <= dueDateOf(intake.fy);
}

/** Whole days after the due date a report came in, by its Nairobi day; 0 when on time. */
export function daysLate(submittedAt: string, dueDate: string): number {
  return Math.max(0, daysBetween(dueDate, submittedAt));
}
