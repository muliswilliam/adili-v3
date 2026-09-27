import { describe, expect, it } from 'vitest';

import { commissionListSearch, hasFilters } from './list-search';

describe('commissionListSearch', () => {
  it('keeps valid filters', () => {
    expect(
      commissionListSearch.parse({ search: 'teach', type: 'federated', reportingOfficer: 'none' }),
    ).toEqual({ search: 'teach', type: 'federated', reportingOfficer: 'none' });
  });

  it('drops unknown values and blank searches instead of failing', () => {
    expect(
      commissionListSearch.parse({ search: '   ', type: 'other', reportingOfficer: 'replaced' }),
    ).toEqual({ search: undefined, type: undefined, reportingOfficer: undefined });
  });

  it('trims the search', () => {
    expect(commissionListSearch.parse({ search: '  psc ' }).search).toBe('psc');
  });
});

describe('hasFilters', () => {
  it('is false for the unfiltered list and true for any filter', () => {
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ search: 'x' })).toBe(true);
    expect(hasFilters({ type: 'hosted' })).toBe(true);
    expect(hasFilters({ reportingOfficer: 'invited' })).toBe(true);
  });
});
