import { describe, expect, it } from 'vitest';

import {
  amendAvailability,
  type AmendFacts,
  isPageSize,
  orderDeclarations,
  pageOf,
} from './my-declarations';

const submitted: AmendFacts = {
  status: 'submitted',
  dueDate: '2026-10-10',
  currentVersion: 2,
  amendingFromVersion: null,
  amendable: true,
};

describe('amend availability (S19)', () => {
  it('is open while the service says so, for the version in force', () => {
    expect(amendAvailability(submitted)).toEqual({
      kind: 'open',
      version: 2,
      dueDate: '2026-10-10',
    });
  });

  it('is closed on a submitted declaration the service no longer lets amend', () => {
    expect(amendAvailability({ ...submitted, amendable: false })).toEqual({
      kind: 'closed',
      dueDate: '2026-10-10',
    });
  });

  it('says an amendment is in progress, from the version it started from', () => {
    expect(
      amendAvailability({
        ...submitted,
        status: 'amending',
        amendingFromVersion: 2,
        amendable: false,
      }),
    ).toEqual({ kind: 'amending', fromVersion: 2 });
  });

  it('offers nothing for a draft or a discarded declaration', () => {
    expect(
      amendAvailability({ ...submitted, status: 'draft', currentVersion: null, amendable: false }),
    ).toEqual({ kind: 'none' });
    expect(amendAvailability({ ...submitted, status: 'discarded', amendable: false })).toEqual({
      kind: 'none',
    });
  });
});

describe('the list', () => {
  const item = (id: string, status: AmendFacts['status'], statementDate: string) => ({
    id,
    status,
    statementDate,
  });

  it('puts drafts and amendments first, then the newest statement date, without discarded', () => {
    const ordered = orderDeclarations([
      item('old', 'submitted', '2023-11-01'),
      item('gone', 'discarded', '2027-11-01'),
      item('new', 'submitted', '2025-11-01'),
      item('amending', 'amending', '2021-11-01'),
      item('draft', 'draft', '2026-09-10'),
    ]);
    expect(ordered.map(({ id }) => id)).toEqual(['draft', 'amending', 'new', 'old']);
  });

  it('pages, clamping to the pages there are', () => {
    const items = Array.from({ length: 12 }, (_, index) => index);
    expect(pageOf(items, 1, 5)).toEqual({ items: [0, 1, 2, 3, 4], page: 1, pages: 3 });
    expect(pageOf(items, 3, 5)).toEqual({ items: [10, 11], page: 3, pages: 3 });
    expect(pageOf(items, 9, 5).page).toBe(3);
    expect(pageOf(items, 0, 5).page).toBe(1);
    expect(pageOf([], 2, 5)).toEqual({ items: [], page: 1, pages: 1 });
  });

  it('takes the page sizes on offer only', () => {
    expect([5, 10, 20].every(isPageSize)).toBe(true);
    expect(isPageSize(7)).toBe(false);
  });
});
