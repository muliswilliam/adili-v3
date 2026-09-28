import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import type { CommissionObligationsSummary } from '../../server/declarations/client';
import {
  cycleLabel,
  cycleOptions,
  hasObligationFilters,
  notOnboardedCount,
  obligationsQuery,
  type ObligationsSearch,
  obligationsSearchSchema,
  showNotOnboarded,
  toggleStatus,
  withFilter,
} from './obligations-query';

/** The filters after a trip through the address bar: written by the router, read back by the page. */
const roundTrip = (search: ObligationsSearch) =>
  obligationsSearchSchema.parse(defaultParseSearch(defaultStringifySearch(search)));

const counts = (upcoming = 0, due = 0, overdue = 0, filed = 0) => ({
  upcoming,
  due,
  overdue,
  filed,
});

/** A biennial cycle under the statutory dates. */
const cycle = (year: number, opened: boolean) => ({
  key: `biennial:${String(year)}`,
  statementDate: `${String(year)}-11-01`,
  dueDate: `${String(year)}-12-31`,
  opensOn: `${String(year)}-07-04`,
  opened,
});

function summary(
  overrides: Partial<CommissionObligationsSummary> = {},
): CommissionObligationsSummary {
  return {
    commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
    cycle: cycle(2027, true),
    cycles: [cycle(2027, true), cycle(2029, false), cycle(2031, false)],
    total: counts(1_204, 18, 7),
    byType: { initial: counts(0, 14, 5), biennial: counts(1_204, 0, 0), final: counts(0, 4, 2) },
    notOnboarded: { due: 9, overdue: 4 },
    ...overrides,
  };
}

describe('S23 obligations filters in the URL', () => {
  it.each<[string, ObligationsSearch]>([
    [
      'every filter',
      {
        type: 'biennial',
        status: 'overdue',
        onboarded: false,
        cycle: 'biennial:2027',
        search: 'PSC/2009',
      },
    ],
    ['onboarded only', { onboarded: true }],
    ['not onboarded only', { onboarded: false }],
    ['a file number of digits', { search: '2019' }],
    ['a name fragment', { search: 'Otieno' }],
    ['nothing', {}],
  ])('round-trips %s', (_, search) => {
    expect(roundTrip(search)).toEqual(search);
  });

  it('writes only the filters that are set, onboarded false included', () => {
    expect(defaultStringifySearch(showNotOnboarded({}))).toBe('?onboarded=false');
    expect(defaultStringifySearch(withFilter({ type: 'final' }, 'type', undefined))).toBe('');
  });

  it('reads a hand-typed URL: digits as a search, onboarded as text', () => {
    expect(
      obligationsSearchSchema.parse(defaultParseSearch('?search=2019&onboarded=false')),
    ).toEqual({ search: '2019', onboarded: false });
    expect(obligationsSearchSchema.parse({ onboarded: 'true', search: ' psc/2009 ' })).toEqual({
      onboarded: true,
      search: 'psc/2009',
    });
  });

  it('drops values it does not know instead of failing the page', () => {
    expect(
      obligationsSearchSchema.parse({
        type: 'annual',
        status: 'cancelled',
        onboarded: 'maybe',
        cycle: 'next year',
        search: 'x'.repeat(101),
      }),
    ).toEqual({});
  });

  it('keeps no page in the URL', () => {
    expect(obligationsSearchSchema.parse({ cursor: 'abc', status: 'due' })).toEqual({
      status: 'due',
    });
  });

  it('leaves blank searches out', () => {
    expect(obligationsSearchSchema.parse({ search: '   ' })).toEqual({});
  });
});

describe('hasObligationFilters', () => {
  it('counts onboarded false as a filter', () => {
    expect(hasObligationFilters({})).toBe(false);
    expect(hasObligationFilters({ onboarded: false })).toBe(true);
    expect(hasObligationFilters({ cycle: 'biennial:2027' })).toBe(true);
  });
});

describe('toggleStatus', () => {
  it('filters by the tile pressed and stops when pressed again, keeping other filters', () => {
    expect(toggleStatus({ type: 'initial' }, 'overdue')).toEqual({
      type: 'initial',
      status: 'overdue',
    });
    expect(toggleStatus({ type: 'initial', status: 'overdue' }, 'overdue')).toEqual({
      type: 'initial',
    });
    expect(toggleStatus({ status: 'due' }, 'upcoming')).toEqual({ status: 'upcoming' });
  });
});

describe('showNotOnboarded', () => {
  it('lists officers not onboarded in any status, keeping search, type and cycle', () => {
    expect(showNotOnboarded({ status: 'upcoming', search: 'PSC', onboarded: true })).toEqual({
      search: 'PSC',
      onboarded: false,
    });
  });
});

describe('obligationsQuery', () => {
  it('sends set filters and the page, and leaves the rest out', () => {
    expect(
      obligationsQuery(
        {
          search: ' Otieno ',
          type: 'final',
          status: 'due',
          onboarded: false,
          cycle: 'biennial:2027',
        },
        { cursor: 'c2', limit: 50 },
      ),
    ).toEqual({
      search: 'Otieno',
      type: 'final',
      status: 'due',
      onboarded: 'false',
      cycle: 'biennial:2027',
      cursor: 'c2',
      limit: 50,
    });
    expect(obligationsQuery({}, { cursor: null })).toEqual({});
  });
});

describe('cycleOptions', () => {
  it('offers the opened cycles, and the current one while it has not opened', () => {
    expect(cycleOptions(summary(), undefined)).toEqual([
      { key: 'biennial:2027', label: 'Biennial 2027', opened: true },
    ]);
    expect(
      cycleOptions(
        summary({
          cycle: cycle(2027, false),
          cycles: [cycle(2027, false), cycle(2029, false), cycle(2031, false)],
        }),
        undefined,
      ),
    ).toEqual([{ key: 'biennial:2027', label: 'Biennial 2027', opened: false }]);
  });

  it('offers every opened cycle, a cycle brought forward included', () => {
    const summaryIn2029 = summary({
      cycle: cycle(2029, true),
      cycles: [cycle(2027, true), cycle(2029, true), cycle(2031, false)],
    });
    expect(cycleOptions(summaryIn2029, undefined).map((option) => option.key)).toEqual([
      'biennial:2027',
      'biennial:2029',
    ]);
  });

  it('keeps a cycle from the URL that is not the current one', () => {
    expect(cycleOptions(summary(), 'biennial:2029').map((option) => option.key)).toEqual([
      'biennial:2027',
      'biennial:2029',
    ]);
    expect(cycleOptions(null, 'biennial:2027')).toEqual([
      { key: 'biennial:2027', label: 'Biennial 2027', opened: true },
    ]);
  });
});

describe('cycleLabel', () => {
  it('names biennial cycles and leaves other keys as they are', () => {
    expect(cycleLabel('biennial:2027')).toBe('Biennial 2027');
    expect(cycleLabel('initial:2027-03-10')).toBe('initial:2027-03-10');
  });
});

describe('notOnboardedCount', () => {
  it('adds due and overdue officers who have not onboarded', () => {
    expect(notOnboardedCount(summary())).toBe(13);
  });
});
