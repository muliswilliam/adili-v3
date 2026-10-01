import { describe, expect, it } from 'vitest';

import type {
  NationalCommissionRow,
  NationalObligationsSummary,
} from '../../server/declarations/client';
import {
  hasNationalObligations,
  NATIONAL_PAGE_SIZE,
  nationalPage,
  nationalSearchSchema,
  nationalTotals,
  sortNationalRows,
  sortState,
  toggleSort,
} from './national-summary';

function row(
  slug: string,
  name: string,
  counts: Partial<NationalCommissionRow['total']> = {},
  notOnboarded = 0,
  lastRosterImportAt: string | null = null,
): NationalCommissionRow {
  return {
    commission: { slug, issuerCode: slug.toUpperCase(), name },
    total: { upcoming: 0, due: 0, overdue: 0, filed: 0, filedLate: 0, ...counts },
    notOnboarded,
    lastRosterImportAt,
  };
}

const npsc = row(
  'npsc',
  'National Police Service Commission',
  { due: 812, overdue: 1_406 },
  1_991,
  '2026-09-11T08:00:00Z',
);
const tsc = row(
  'tsc',
  'Teachers Service Commission',
  { due: 612, overdue: 388 },
  702,
  '2026-09-23T08:00:00Z',
);
const psc = row(
  'psc',
  'Public Service Commission',
  { due: 47, overdue: 26 },
  48,
  '2026-09-26T08:00:00Z',
);
const jsc = row('jsc', 'Judicial Service Commission');
const caj = row(
  'caj',
  'Commission on Administrative Justice',
  { due: 1 },
  0,
  '2026-09-05T08:00:00Z',
);

const names = (rows: NationalCommissionRow[]) => rows.map((r) => r.commission.slug);

describe('S16 national summary: sorting', () => {
  it('sorts by overdue, most first, by default', () => {
    const sort = sortState({});
    expect(sort).toEqual({ sort: 'overdue', dir: 'desc' });
    expect(names(sortNationalRows([psc, jsc, npsc, caj, tsc], sort))).toEqual([
      'npsc',
      'tsc',
      'psc',
      // Ties by name.
      'caj',
      'jsc',
    ]);
  });

  it('sorts by name A to Z first, then Z to A', () => {
    const byName = toggleSort({}, 'name');
    expect(byName).toEqual({ sort: 'name' });
    expect(names(sortNationalRows([psc, jsc, npsc], sortState(byName)))).toEqual([
      'jsc',
      'npsc',
      'psc',
    ]);
    const reversed = toggleSort(byName, 'name');
    expect(reversed).toEqual({ sort: 'name', dir: 'desc' });
    expect(names(sortNationalRows([psc, jsc, npsc], sortState(reversed)))).toEqual([
      'psc',
      'npsc',
      'jsc',
    ]);
  });

  it('flips the default column back to fewest overdue first, and keeps the URL short', () => {
    expect(toggleSort({}, 'overdue')).toEqual({ dir: 'asc' });
    expect(toggleSort({ dir: 'asc' }, 'overdue')).toEqual({});
  });

  it('goes back to the first page when the order changes', () => {
    expect(toggleSort({ page: 2 }, 'due')).toEqual({ sort: 'due' });
  });

  it('puts Commissions with no roster import last, whichever way the imports are sorted', () => {
    expect(names(sortNationalRows([jsc, psc, npsc], { sort: 'lastImport', dir: 'desc' }))).toEqual([
      'psc',
      'npsc',
      'jsc',
    ]);
    expect(names(sortNationalRows([jsc, psc, npsc], { sort: 'lastImport', dir: 'asc' }))).toEqual([
      'npsc',
      'psc',
      'jsc',
    ]);
  });

  it('sorts by not onboarded', () => {
    expect(
      names(sortNationalRows([psc, tsc, npsc], { sort: 'notOnboarded', dir: 'desc' })),
    ).toEqual(['npsc', 'tsc', 'psc']);
  });
});

describe('S16 national summary: URL', () => {
  it('drops values a hand-typed URL got wrong', () => {
    expect(nationalSearchSchema.parse({ sort: 'salary', dir: 'up', page: -1 })).toEqual({});
    expect(nationalSearchSchema.parse({ sort: 'due', dir: 'asc', page: '3' })).toEqual({
      sort: 'due',
      dir: 'asc',
      page: 3,
    });
  });
});

describe('S16 national summary: totals and pages', () => {
  const summary: NationalObligationsSummary = {
    cycle: {
      key: 'biennial:2027',
      statementDate: '2027-11-01',
      dueDate: '2027-12-31',
      opensOn: '2027-07-04',
      opened: true,
    },
    commissions: [npsc, tsc, psc, jsc, caj],
    totals: { upcoming: 0, due: 1_472, overdue: 1_820, filed: 0, filedLate: 0 },
  };

  it('takes the counts from the service totals and adds up not onboarded', () => {
    expect(nationalTotals(summary)).toEqual({
      commissions: 5,
      upcoming: 0,
      due: 1_472,
      overdue: 1_820,
      notOnboarded: 2_741,
    });
  });

  it('knows when no Commission has obligations yet', () => {
    expect(hasNationalObligations(summary)).toBe(true);
    expect(hasNationalObligations({ ...summary, commissions: [jsc] })).toBe(false);
    expect(hasNationalObligations({ ...summary, commissions: [] })).toBe(false);
  });

  it('pages the sorted rows and clamps a page past the end', () => {
    const rows = Array.from({ length: NATIONAL_PAGE_SIZE + 3 }, (_, index) =>
      row(`c${String(index).padStart(2, '0')}`, `Commission ${index}`),
    );
    expect(nationalPage(rows, undefined)).toMatchObject({
      page: 1,
      pages: 2,
      from: 1,
      to: NATIONAL_PAGE_SIZE,
    });
    const last = nationalPage(rows, 9);
    expect(last).toMatchObject({
      page: 2,
      from: NATIONAL_PAGE_SIZE + 1,
      to: NATIONAL_PAGE_SIZE + 3,
    });
    expect(last.rows).toHaveLength(3);
  });
});
