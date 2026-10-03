import { formatDate } from '@adili/ui';
import { z } from 'zod';

import type {
  DeclarationProgress,
  ProgressCounts,
  ProgressRow,
} from '../../server/declarations/client';
import { cycleLabel } from '../obligations/obligations-query';
import { type ClientPage, clientPage } from '../paging';

/** Reporting entities per page of the coverage table. */
export const PROGRESS_PAGE_SIZE = 25;

/** The longest reporting entity search the page takes. */
export const PROGRESS_SEARCH_MAX = 100;

/**
 * The coverage page's cycle, search and page, kept in the URL so a view can be shared, reloaded
 * and reached with Back. The cycle is the declarations service's to count; the search and the page
 * are applied in the browser. Values left at their default are absent; wrong ones are dropped
 * rather than failing.
 */
/** A biennial cycle key as the declarations service takes it, e.g. `biennial:2027`. */
export const progressCycleKey = z.string().regex(/^biennial:\d{4}$/);

export const progressSearchSchema = z.object({
  cycle: progressCycleKey.optional().catch(undefined),
  search: z.string().trim().min(1).max(PROGRESS_SEARCH_MAX).optional().catch(undefined),
  page: z.coerce.number().int().min(2).optional().catch(undefined),
});

export type ProgressSearch = z.infer<typeof progressSearchSchema>;

/**
 * How the coverage route loads: the service counts the cycle, so a cycle change loads (a cycle
 * seen before is counted again, as the router reloads a stale match beside another of its route);
 * a search or page change keeps the counts in hand. No `shouldReload`: one returning false for a
 * route already on show would serve a cycle's earlier counts when it is chosen again.
 */
export const PROGRESS_ROUTE_LOADING = {
  validateSearch: progressSearchSchema,
  loaderDeps: ({ search }: { search: ProgressSearch }) => ({ cycle: search.cycle }),
};

const KEYS = ['notStarted', 'inProgress', 'submitted', 'late'] as const;

/** Obligations counted: the four counts do not overlap (late is overdue, with a draft or not). */
export function obligationTotal(counts: ProgressCounts): number {
  return KEYS.reduce((sum, key) => sum + counts[key], 0);
}

/** `part` as a whole percentage of `whole`, rounded down so 100% means all; 0 of nothing. */
export function sharePercent(part: number, whole: number): number {
  return whole > 0 ? Math.floor((part / whole) * 100) : 0;
}

/**
 * The reporting entities whose name holds `search`, in any case, in the order counted (by name,
 * declarants with none last). Those declarants have no name to match, so a search leaves them out.
 */
export function matchingRows(rows: readonly ProgressRow[], search: string | undefined) {
  const needle = search?.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) => row.reportingEntity?.name.toLowerCase().includes(needle));
}

export interface ProgressTotals {
  counts: ProgressCounts;
  /** Reporting entities matching the search; null without one (the total is everyone's). */
  matching: number | null;
}

/** The totals row: the service's own total, or the matching reporting entities added up. */
export function progressTotals(
  progress: DeclarationProgress,
  search: string | undefined,
): ProgressTotals {
  if (!search?.trim()) return { counts: progress.total, matching: null };
  const rows = matchingRows(progress.reportingEntities, search);
  const counts: ProgressCounts = { notStarted: 0, inProgress: 0, submitted: 0, late: 0 };
  for (const row of rows) for (const key of KEYS) counts[key] += row.counts[key];
  return { counts, matching: rows.length };
}

/** Whether the cycle counts any obligation; otherwise the page is an empty state. */
export function hasProgress(progress: DeclarationProgress): boolean {
  return obligationTotal(progress.total) > 0;
}

/** A page of the coverage table: the reporting entities the search keeps, 25 to a page. */
export function progressPage(
  rows: readonly ProgressRow[],
  requested: number | undefined,
): ClientPage<ProgressRow> {
  return clientPage(rows, requested, PROGRESS_PAGE_SIZE);
}

export interface ProgressCycle {
  key: string;
  /** "Biennial 2027", or "Biennial 2027 (opens 4 Jul 2027)" while it has not opened. */
  label: string;
}

/**
 * The cycle select's options: the cycles opened, oldest first, the current one (the latest opened,
 * or the calendar's first while none has, as the service picks it without `cycle`) so there is
 * always a way back to it, and the one counted (e.g. a later one asked for in the URL).
 */
export function progressCycles(progress: DeclarationProgress): ProgressCycle[] {
  const current = progress.cycles.filter((cycle) => cycle.opened).at(-1) ?? progress.cycles[0];
  const shown = progress.cycles.filter(
    (cycle) => cycle.opened || cycle.key === current?.key || cycle.key === progress.cycle.key,
  );
  if (!shown.some((cycle) => cycle.key === progress.cycle.key)) shown.push(progress.cycle);
  return shown.map((cycle) => ({
    key: cycle.key,
    label: cycle.opened
      ? cycleLabel(cycle.key)
      : `${cycleLabel(cycle.key)} (opens ${formatDate(cycle.opensOn)})`,
  }));
}
