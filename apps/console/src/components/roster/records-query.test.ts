import { describe, expect, it } from 'vitest';

import {
  appendPage,
  hasRecordFilters,
  noMatchesHint,
  recordsSearchSchema,
  rosterRecordsQuery,
  toggleFlagged,
  toggleIdentityMismatch,
} from './records-query';

describe('recordsSearchSchema', () => {
  it('reads search, state and the toggles from the URL', () => {
    expect(
      recordsSearchSchema.parse({
        search: ' PSC/2019 ',
        state: 'onboarded',
        flagged: true,
        identityMismatch: true,
      }),
    ).toEqual({ search: 'PSC/2019', state: 'onboarded', flagged: true, identityMismatch: true });
  });

  it('drops values it does not know instead of failing the page', () => {
    expect(
      recordsSearchSchema.parse({ state: 'flagged', flagged: 'yes', search: 'x'.repeat(201) }),
    ).toEqual({});
  });

  it('leaves switched-off toggles and blank searches out', () => {
    expect(
      recordsSearchSchema.parse({ flagged: false, identityMismatch: false, search: '  ' }),
    ).toEqual({});
  });

  it('reads a national ID typed into the URL as a search', () => {
    expect(recordsSearchSchema.parse({ search: 27481123 })).toEqual({ search: '27481123' });
  });

  it('keeps no page in the URL', () => {
    expect(recordsSearchSchema.parse({ cursor: 'abc' })).toEqual({});
  });
});

describe('hasRecordFilters', () => {
  it('is false with no filters', () => {
    expect(hasRecordFilters({})).toBe(false);
  });

  it.each([{ search: 'Otieno' }, { state: 'exited' as const }, { flagged: true as const }])(
    'is true with %o',
    (search) => {
      expect(hasRecordFilters(search)).toBe(true);
    },
  );
});

describe('rosterRecordsQuery', () => {
  it('sends a full national ID as the search', () => {
    expect(rosterRecordsQuery({ search: '27481123' })).toEqual({ search: '27481123' });
  });

  it('sends flagged="true" only when the toggle is on', () => {
    expect(rosterRecordsQuery({ flagged: true })).toEqual({ flagged: 'true' });
    expect(rosterRecordsQuery({})).toEqual({});
  });

  it('asks for identityMismatch=true when the filter is on', () => {
    expect(rosterRecordsQuery({ identityMismatch: true })).toEqual({ identityMismatch: 'true' });
  });

  it('combines the filters with the page cursor and size', () => {
    expect(
      rosterRecordsQuery(
        { search: ' TSC/1 ', state: 'not_onboarded', flagged: true },
        { cursor: 'abc', limit: 50 },
      ),
    ).toEqual({
      search: 'TSC/1',
      state: 'not_onboarded',
      flagged: 'true',
      cursor: 'abc',
      limit: 50,
    });
  });

  it('asks for the first page without a cursor', () => {
    expect(rosterRecordsQuery({}, { cursor: null, limit: 50 })).toEqual({ limit: 50 });
  });
});

describe('toggleFlagged', () => {
  it('turns the filter on, keeping the others', () => {
    expect(toggleFlagged({ search: 'Otieno' })).toEqual({ search: 'Otieno', flagged: true });
  });

  it('turns the filter off', () => {
    expect(toggleFlagged({ flagged: true, state: 'onboarded' })).toEqual({ state: 'onboarded' });
  });
});

describe('toggleIdentityMismatch', () => {
  it('turns the filter on', () => {
    expect(toggleIdentityMismatch({ search: 'Otieno' })).toEqual({
      search: 'Otieno',
      identityMismatch: true,
    });
  });

  it('turns the filter off', () => {
    expect(toggleIdentityMismatch({ identityMismatch: true, flagged: true })).toEqual({
      flagged: true,
    });
  });
});

describe('noMatchesHint', () => {
  it('points at partial national IDs for a search of digits', () => {
    expect(noMatchesHint({ search: '3456' })).toBe('partial-national-id');
  });

  it('gives the general hint otherwise', () => {
    expect(noMatchesHint({ search: 'Wanjiru' })).toBe('other');
    expect(noMatchesHint({ search: 'PSC/2019' })).toBe('other');
    expect(noMatchesHint({ state: 'exited' })).toBe('other');
  });
});

describe('appendPage', () => {
  it('adds the next page and moves the cursor on', () => {
    expect(
      appendPage(
        { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'c1' },
        { items: [{ id: 'c' }], nextCursor: null },
      ),
    ).toEqual({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], nextCursor: null });
  });

  it('does not list a record twice', () => {
    expect(
      appendPage(
        { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'c1' },
        { items: [{ id: 'b' }, { id: 'c' }], nextCursor: 'c2' },
      ).items.map((item) => item.id),
    ).toEqual(['a', 'b', 'c']);
  });
});
