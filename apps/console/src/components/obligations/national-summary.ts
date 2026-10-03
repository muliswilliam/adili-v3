import { z } from 'zod';

import type {
  NationalCommissionRow,
  NationalObligationsSummary,
} from '../../server/declarations/client';
import { type ClientPage, clientPage } from '../paging';

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

export type NationalPage = ClientPage<NationalCommissionRow>;

export function nationalPage(
  rows: readonly NationalCommissionRow[],
  requested: number | undefined,
): NationalPage {
  return clientPage(rows, requested, NATIONAL_PAGE_SIZE);
}
