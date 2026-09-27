import { describe, expect, it } from 'vitest';

import { MOCK_COMMISSIONS } from '../../server/directory/mock.server';
import { pagingView } from './paging';

const page = (from: number, to: number, nextCursor: string | null) => ({
  items: MOCK_COMMISSIONS.slice(from, to),
  nextCursor,
});

describe('pagingView', () => {
  const pages = [page(0, 10, '10'), page(10, 18, null)];

  it('starts on the first page with only Next', () => {
    const view = pagingView(pages.slice(0, 1), 0);
    expect(view).toMatchObject({ from: 1, to: 10, hasPrevious: false, hasNext: true });
    expect(view).toMatchObject({ seen: 10, more: true });
  });

  it('numbers rows on later pages from the pages before them', () => {
    const view = pagingView(pages, 1);
    expect(view).toMatchObject({ from: 11, to: 18, hasPrevious: true, hasNext: false });
    expect(view).toMatchObject({ seen: 18, more: false });
  });

  it('steps back through pages already fetched', () => {
    const view = pagingView(pages, 0);
    expect(view.page).toBe(pages[0]);
    expect(view).toMatchObject({ hasPrevious: false, hasNext: true, seen: 18, more: false });
  });

  it('shows zero rows for an empty page', () => {
    expect(pagingView([page(0, 0, null)], 0)).toMatchObject({ from: 0, to: 0, seen: 0 });
  });
});
