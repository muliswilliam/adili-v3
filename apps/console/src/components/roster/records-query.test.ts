import { describe, expect, it } from 'vitest';

import { recordsSearchSchema, rosterRecordsQuery, toggleIdentityMismatch } from './records-query';

describe('rosterRecordsQuery', () => {
  it('asks for identityMismatch=true when the filter is on', () => {
    expect(rosterRecordsQuery({ identityMismatch: true }).toString()).toBe('identityMismatch=true');
  });

  it('leaves switched-off filters out', () => {
    expect(rosterRecordsQuery({ identityMismatch: false, flagged: false }).toString()).toBe('');
  });

  it('combines the filters with search, state, cursor and limit', () => {
    const query = rosterRecordsQuery(
      {
        search: ' TSC/1 ',
        state: 'not_onboarded',
        flagged: true,
        identityMismatch: true,
        cursor: 'abc',
      },
      50,
    );

    expect(Object.fromEntries(query)).toEqual({
      search: 'TSC/1',
      state: 'not_onboarded',
      flagged: 'true',
      identityMismatch: 'true',
      cursor: 'abc',
      limit: '50',
    });
  });
});

describe('toggleIdentityMismatch', () => {
  it('turns the filter on and goes back to the first page', () => {
    expect(toggleIdentityMismatch({ search: 'Otieno', cursor: 'abc' })).toEqual({
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

describe('recordsSearchSchema', () => {
  it('reads the filter from route search params', () => {
    expect(recordsSearchSchema.parse({ identityMismatch: true })).toEqual({
      identityMismatch: true,
    });
  });

  it('rejects an unknown state', () => {
    expect(recordsSearchSchema.safeParse({ state: 'flagged' }).success).toBe(false);
  });
});
