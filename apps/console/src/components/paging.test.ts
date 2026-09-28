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

  it('keeps the offset unknown past and back to a page a shared link opened', () => {
    const shared = { ...filters, cursor: '20' };
    const next = nextPage(shared, page(0, 5, '25'), pagingFor(shared.cursor, null));
    if (!next) throw new Error('expected a next page');
    expect(next.state).toEqual({ trail: [{ cursor: '20', offset: null }], offset: null });

    const after = pagingFor(next.search.cursor, next.state);
    expect(pagingView(page(5, 10, null), after)).toMatchObject({ range: null, hasPrevious: true });

    // Previous returns to the shared page, still not counted from 1, and still with Previous.
    const back = previousPage(next.search, after);
    expect(back).toEqual({
      search: { ...filters, cursor: '20' },
      state: { trail: [], offset: null },
    });
    const shown = pagingFor(back.search.cursor, back.state);
    expect(pagingView(page(0, 5, '25'), shown)).toMatchObject({ range: null, hasPrevious: true });
    expect(previousPage(back.search, shown).search.cursor).toBeUndefined();
  });

  it('ignores history state that does not describe paging', () => {
    expect(pagingFor('10', { trail: 'nope' })).toEqual({ trail: [], offset: null });
  });

  it('has no Next after the last page', () => {
    expect(nextPage(filters, page(0, 3, null), pagingFor(undefined, undefined))).toBeNull();
  });
});
