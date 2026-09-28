import { z } from 'zod';

import type {
  NationalCommissionRow,
  NationalObligationsSummary,
} from '../../server/declarations/client';

/** Columns the national table sorts by. */
export const NATIONAL_SORTS = [
  'name',
  'upcoming',
  'due',
  'overdue',
  'notOnboarded',
  'lastImport',
] as const;

export type NationalSort = (typeof NATIONAL_SORTS)[number];
export type SortDirection = 'asc' | 'desc';

/** Commissions per page: the whole country fits on two. */
export const NATIONAL_PAGE_SIZE = 25;

/** The spec's order: most overdue first. */
const DEFAULT_SORT: NationalSort = 'overdue';

/** Names read A to Z first; counts and imports most or latest first. */
const firstDirection = (sort: NationalSort): SortDirection => (sort === 'name' ? 'asc' : 'desc');

/**
 * The table's order and page, kept in the URL so a view can be shared, reloaded and reached with
 * Back. Values left at their default are absent; wrong ones are dropped rather than failing.
 */
export const nationalSearchSchema = z.object({
  sort: z.enum(NATIONAL_SORTS).optional().catch(undefined),
  dir: z.enum(['asc', 'desc']).optional().catch(undefined),
  page: z.coerce.number().int().min(2).optional().catch(undefined),
});

export type NationalSearch = z.infer<typeof nationalSearchSchema>;

export interface SortState {
  sort: NationalSort;
  dir: SortDirection;
}

export function sortState(search: NationalSearch): SortState {
  const sort = search.sort ?? DEFAULT_SORT;
  return { sort, dir: search.dir ?? firstDirection(sort) };
}

/**
 * A column header pressed: the column it already sorts by flips; another column sorts in its
 * first direction. Either way the table goes back to its first page.
 */
export function toggleSort(search: NationalSearch, sort: NationalSort): NationalSearch {
  const current = sortState(search);
  const dir =
    current.sort === sort ? (current.dir === 'asc' ? 'desc' : 'asc') : firstDirection(sort);
  return {
    ...(sort === DEFAULT_SORT ? {} : { sort }),
    ...(dir === firstDirection(sort) ? {} : { dir }),
  };
}

function sortValue(row: NationalCommissionRow, sort: Exclude<NationalSort, 'name' | 'lastImport'>) {
  return sort === 'notOnboarded' ? row.notOnboarded : row.total[sort];
}

const byName = (a: NationalCommissionRow, b: NationalCommissionRow) =>
  a.commission.name.localeCompare(b.commission.name, 'en', { numeric: true });

/** The rows in the order asked for; ties by name, and Commissions never imported last. */
export function sortNationalRows(
  rows: readonly NationalCommissionRow[],
  { sort, dir }: SortState,
): NationalCommissionRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort === 'name') return byName(a, b) * sign;
    if (sort === 'lastImport') {
      const x = a.lastRosterImportAt;
      const y = b.lastRosterImportAt;
      if (x === y) return byName(a, b);
      if (x === null) return 1;
      if (y === null) return -1;
      return (Date.parse(x) - Date.parse(y)) * sign || byName(a, b);
    }
    return (sortValue(a, sort) - sortValue(b, sort)) * sign || byName(a, b);
  });
}

export interface NationalTotals {
  commissions: number;
  upcoming: number;
  due: number;
  overdue: number;
  notOnboarded: number;
}

/** The totals row: the service's national counts, and not onboarded added up per Commission. */
export function nationalTotals(summary: NationalObligationsSummary): NationalTotals {
  return {
    commissions: summary.commissions.length,
    upcoming: summary.totals.upcoming,
    due: summary.totals.due,
    overdue: summary.totals.overdue,
    notOnboarded: summary.commissions.reduce((sum, row) => sum + row.notOnboarded, 0),
  };
}

/** Whether any Commission has an obligation in the cycle; otherwise the table is an empty state. */
export function hasNationalObligations(summary: NationalObligationsSummary): boolean {
  return summary.commissions.some(({ total }) =>
    Boolean(total.upcoming || total.due || total.overdue || total.filed),
  );
}

export interface NationalPage {
  rows: NationalCommissionRow[];
  /** 1-based, clamped to the pages there are. */
  page: number;
  pages: number;
  /** 1-based positions of the first and last row on the page. */
  from: number;
  to: number;
}

export function nationalPage(
  rows: readonly NationalCommissionRow[],
  requested: number | undefined,
): NationalPage {
  const pages = Math.max(1, Math.ceil(rows.length / NATIONAL_PAGE_SIZE));
  const page = Math.min(Math.max(1, requested ?? 1), pages);
  const start = (page - 1) * NATIONAL_PAGE_SIZE;
  const shown = rows.slice(start, start + NATIONAL_PAGE_SIZE);
  return { rows: shown, page, pages, from: start + 1, to: start + shown.length };
}

/** Days before a biennial statement date that the platform creates the cycle's obligations. */
const CYCLE_OPENS_DAYS_BEFORE = 120;

export interface BiennialCycleDates {
  year: string;
  /** When the cycle's obligations are created. */
  opensOn: string;
  statementDate: string;
  dueDate: string;
}

/**
 * The statutory dates of a biennial cycle (Act s.34(2): statement 1 November, due 31 December)
 * and the day it opens, from its key (`biennial:2027`); null for any other key. The national
 * summary names only the cycle, so the page words its dates from the calendar.
 */
export function biennialCycleDates(cycleKey: string): BiennialCycleDates | null {
  const year = /^biennial:(\d{4})$/.exec(cycleKey)?.[1];
  if (!year) return null;
  const statement = new Date(`${year}-11-01T00:00:00Z`);
  const opens = new Date(statement.getTime() - CYCLE_OPENS_DAYS_BEFORE * 24 * 60 * 60 * 1000);
  return {
    year,
    opensOn: opens.toISOString().slice(0, 10),
    statementDate: `${year}-11-01`,
    dueDate: `${year}-12-31`,
  };
}
