import { describe, expect, it } from 'vitest';

import { searchForFilters } from '../../lib/commission-filters';
import { MOCK_COMMISSIONS } from '../../mocks/directory/fixtures';
import { nextPage, pagingFor, pagingView, previousPage } from './paging';

const page = (from: number, to: number, nextCursor: string | null) => ({
  items: MOCK_COMMISSIONS.slice(from, to),
  nextCursor,
});

describe('commission list paging', () => {
  const filters = { type: 'hosted' as const };

  it('starts on the first page with only Next', () => {
    const paging = pagingFor(undefined, undefined);
    const view = pagingView(page(0, 10, '10'), paging);
    expect(view).toEqual({
      range: { from: 1, to: 10 },
      count: 10,
      more: true,
      hasPrevious: false,
      hasNext: true,
    });
  });

  it('puts the next cursor in the URL and the way back in history state', () => {
    const first = page(0, 10, '10');
    const next = nextPage(filters, first, pagingFor(undefined, undefined));
    if (!next) throw new Error('expected a next page');
    expect(next).toEqual({
      search: { type: 'hosted', cursor: '10' },
      state: { trail: [{ cursor: null, offset: 0 }], offset: 10 },
    });

    // Back or reload bring the same URL and history state back.
    const paging = pagingFor(next.search.cursor, next.state);
    expect(pagingView(page(10, 18, null), paging)).toEqual({
      range: { from: 11, to: 18 },
      count: 18,
      more: false,
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
    const view = pagingView(page(0, 5, null), paging);
    expect(view).toMatchObject({ range: null, count: 5, more: true, hasPrevious: true });
    expect(previousPage(search, paging).search.cursor).toBeUndefined();
  });

  it('ignores history state that does not describe paging', () => {
    expect(pagingFor('10', { trail: 'nope' })).toEqual({ trail: [], offset: null });
  });

  it('has no Next after the last page', () => {
    expect(nextPage(filters, page(0, 3, null), pagingFor(undefined, undefined))).toBeNull();
  });

  it('shows zero rows for an empty page', () => {
    expect(pagingView(page(0, 0, null), pagingFor(undefined, undefined))).toMatchObject({
      range: null,
      count: 0,
      more: false,
    });
  });

  it('drops the cursor when the filters change', () => {
    expect(searchForFilters({ search: 'ken', type: 'federated' })).toEqual({
      search: 'ken',
      type: 'federated',
      reportingOfficer: undefined,
    });
    expect('cursor' in searchForFilters({ ...filters, cursor: '10' } as never)).toBe(false);
  });
});
