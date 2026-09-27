import { describe, expect, it } from 'vitest';

import type { Commission } from '../server/directory/client';
import { nextPage, pagingFor, pagingView, previousPage } from './paging';

const commissions = Array.from({ length: 18 }, (_, index) => ({ id: String(index) }) as Commission);

const page = (from: number, to: number, nextCursor: string | null) => ({
  items: commissions.slice(from, to),
  nextCursor,
});

describe('cursor paging', () => {
  const filters = { type: 'hosted' as const };

  it('starts on the first page with only Next', () => {
    const view = pagingView(page(0, 10, '10'), pagingFor(undefined, undefined));
    expect(view).toEqual({ range: { from: 1, to: 10 }, hasPrevious: false, hasNext: true });
  });

  it('puts the next cursor in the URL and the way back in history state', () => {
    const next = nextPage(filters, page(0, 10, '10'), pagingFor(undefined, undefined));
    if (!next) throw new Error('expected a next page');
    expect(next).toEqual({
      search: { type: 'hosted', cursor: '10' },
      state: { trail: [{ cursor: null, offset: 0 }], offset: 10 },
    });

    // Back or reload bring the same URL and history state back.
    const paging = pagingFor(next.search.cursor, next.state);
    expect(pagingView(page(10, 18, null), paging)).toEqual({
      range: { from: 11, to: 18 },
      hasPrevious: true,
      hasNext: false,
    });
    expect(previousPage(next.search, paging)).toEqual({
      search: { type: 'hosted', cursor: undefined },
      state: { trail: [], offset: 0 },
    });
  });

  it('opens a shared link to a later page with Previous to the first page', () => {
    const search = { ...filters, cursor: '20' };
    const paging = pagingFor(search.cursor, null);
    expect(pagingView(page(0, 5, null), paging)).toMatchObject({ range: null, hasPrevious: true });
    expect(previousPage(search, paging).search.cursor).toBeUndefined();
  });

  it('ignores history state that does not describe paging', () => {
    expect(pagingFor('10', { trail: 'nope' })).toEqual({ trail: [], offset: null });
  });

  it('has no Next after the last page', () => {
    expect(nextPage(filters, page(0, 3, null), pagingFor(undefined, undefined))).toBeNull();
  });
});
