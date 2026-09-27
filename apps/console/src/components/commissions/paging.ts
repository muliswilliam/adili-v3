import { z } from 'zod';

import type { CommissionPage } from '../../server/directory/client';
import type { CommissionListSearch } from './list-search';

/**
 * Previous and Next over the directory's forward-only cursors. The page on show is the `cursor`
 * search param, so Back, reload and shared links open the same page. The way back (the cursors
 * of the pages before it) and the row offset live in history state: they survive Back and
 * reload but not a shared link, which then offers Previous to the first page.
 */
const pagingStateSchema = z.object({
  /** The pages before this one, oldest first; `null` is the first page. */
  trail: z.array(z.object({ cursor: z.string().nullable(), offset: z.number().int().min(0) })),
  /** Rows before this page. */
  offset: z.number().int().min(0),
});

export type PagingState = z.infer<typeof pagingStateSchema>;

const firstPage: PagingState = { trail: [], offset: 0 };

/** Where the page on show sits; `offset` is null when a shared link opened a later page. */
export interface Paging {
  trail: PagingState['trail'];
  offset: number | null;
}

/** Reads the paging for the page on show from its cursor and whatever history state holds. */
export function pagingFor(cursor: string | undefined, state: unknown): Paging {
  if (!cursor) return { trail: [], offset: 0 };
  const parsed = pagingStateSchema.safeParse(state);
  return parsed.success ? parsed.data : { trail: [], offset: null };
}

export interface PagingView {
  /** 1-based position of the first and last row on the page, when known. */
  range: { from: number; to: number } | null;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function pagingView(
  page: Pick<CommissionPage, 'items' | 'nextCursor'>,
  paging: Paging,
): PagingView {
  const rows = page.items.length;
  const known = paging.offset !== null;
  const offset = paging.offset ?? 0;
  return {
    range: known && rows > 0 ? { from: offset + 1, to: offset + rows } : null,
    hasPrevious: paging.offset !== 0,
    hasNext: page.nextCursor !== null,
  };
}

export interface PageLocation {
  search: CommissionListSearch;
  state: PagingState;
}

/** The location of the page after this one. */
export function nextPage(
  search: CommissionListSearch,
  page: Pick<CommissionPage, 'items' | 'nextCursor'>,
  paging: Paging,
): PageLocation | null {
  if (!page.nextCursor) return null;
  const offset = paging.offset ?? 0;
  return {
    search: { ...search, cursor: page.nextCursor },
    state: {
      trail: [...paging.trail, { cursor: search.cursor ?? null, offset }],
      offset: offset + page.items.length,
    },
  };
}

/** The location of the page before this one; the first page when the way back is unknown. */
export function previousPage(search: CommissionListSearch, paging: Paging): PageLocation {
  const before = paging.trail.at(-1);
  return {
    search: { ...search, cursor: before?.cursor ?? undefined },
    state: before ? { trail: paging.trail.slice(0, -1), offset: before.offset } : firstPage,
  };
}
