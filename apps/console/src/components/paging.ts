import { z } from 'zod';

/**
 * Previous and Next over the directory's forward-only cursors. In a list page the page on show
 * is the `cursor` search param, so Back, reload and shared links open the same page, and the way
 * back (the cursors of the pages before it) and the row offset live in history state: they
 * survive Back and reload but not a shared link, which then offers Previous to the first page.
 * A list inside a page (an import's rejected rows) keeps both in component state instead.
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

export function pagingView(page: CursorPage, paging: Paging): PagingView {
  const rows = page.items.length;
  const known = paging.offset !== null;
  const offset = paging.offset ?? 0;
  return {
    range: known && rows > 0 ? { from: offset + 1, to: offset + rows } : null,
    hasPrevious: paging.offset !== 0,
    hasNext: page.nextCursor !== null,
  };
}

/** One page of a cursor-paged directory list. */
export interface CursorPage {
  items: readonly unknown[];
  nextCursor: string | null;
}

/** The search params of a paged list: its filters and the page's cursor. */
export interface CursorSearch {
  cursor?: string | undefined;
  [param: string]: unknown;
}

export interface PageLocation<S extends CursorSearch = CursorSearch> {
  search: S & { cursor?: string | undefined };
  state: PagingState;
}

/** The location of the page after this one. */
export function nextPage<S extends CursorSearch>(
  search: S,
  page: CursorPage,
  paging: Paging,
): PageLocation<S> | null {
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
export function previousPage<S extends CursorSearch>(search: S, paging: Paging): PageLocation<S> {
  const before = paging.trail.at(-1);
  return {
    search: { ...search, cursor: before?.cursor ?? undefined },
    state: before ? { trail: paging.trail.slice(0, -1), offset: before.offset } : firstPage,
  };
}
