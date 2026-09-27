import type { CommissionPage } from '../../server/directory/types';

/**
 * Previous and Next over a forward-only cursor list. The directory only hands out a cursor to the
 * next page, so the pages fetched so far are kept (in order) and Previous steps back through them.
 */
export interface PagingView {
  page: CommissionPage;
  /** 1-based position of the first and last row on this page. */
  from: number;
  to: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** Rows across every page fetched so far, and whether the directory has more after them. */
  seen: number;
  more: boolean;
}

export function pagingView(pages: readonly CommissionPage[], index: number): PagingView {
  const current = Math.min(Math.max(index, 0), pages.length - 1);
  const page = pages[current];
  if (!page) throw new Error('pagingView needs at least one page');
  const count = (list: readonly CommissionPage[]) =>
    list.reduce((total, item) => total + item.items.length, 0);
  const offset = count(pages.slice(0, current));
  return {
    page,
    from: page.items.length > 0 ? offset + 1 : 0,
    to: offset + page.items.length,
    hasPrevious: current > 0,
    hasNext: page.nextCursor !== null,
    seen: count(pages),
    more: pages.at(-1)?.nextCursor != null,
  };
}
