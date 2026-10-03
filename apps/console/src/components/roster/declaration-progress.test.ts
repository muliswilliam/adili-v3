import { describe, expect, it } from 'vitest';

import type { DeclarationProgress, ProgressRow } from '../../server/declarations/client';
import {
  hasProgress,
  matchingRows,
  obligationTotal,
  PROGRESS_PAGE_SIZE,
  progressCycles,
  progressPage,
  progressSearchSchema,
  progressTotals,
  sharePercent,
} from './declaration-progress';

function row(
  name: string | null,
  counts: Partial<ProgressRow['counts']> = {},
  id = name ?? 'none',
): ProgressRow {
  return {
    reportingEntity: name === null ? null : { id, name },
    counts: { notStarted: 0, inProgress: 0, submitted: 0, late: 0, ...counts },
  };
}

const cycle = (key: string, opened: boolean, opensOn = '2027-07-04') => ({
  key,
  statementDate: `${key.slice(-4)}-11-01`,
  dueDate: `${key.slice(-4)}-12-31`,
  opensOn,
  opened,
});

const health = row('Ministry of Health', { notStarted: 4, inProgress: 3, submitted: 10, late: 1 });
const treasury = row('The National Treasury', { notStarted: 2, inProgress: 1, submitted: 5 });
const publicService = row('State Department for Public Service', { inProgress: 2, late: 3 });
const none = row(null, { notStarted: 1 });

function progress(
  reportingEntities: ProgressRow[] = [health, publicService, treasury, none],
): DeclarationProgress {
  return {
    commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
    cycle: cycle('biennial:2025', true, '2025-07-04'),
    cycles: [cycle('biennial:2025', true, '2025-07-04'), cycle('biennial:2027', false)],
    reportingEntities,
    total: { notStarted: 7, inProgress: 6, submitted: 15, late: 4 },
  };
}

describe('progressSearchSchema', () => {
  it('keeps a cycle key, a search and a page past the first', () => {
    expect(
      progressSearchSchema.parse({ cycle: 'biennial:2027', search: ' health ', page: '2' }),
    ).toEqual({ cycle: 'biennial:2027', search: 'health', page: 2 });
  });

  it('drops values the page cannot use rather than failing', () => {
    expect(progressSearchSchema.parse({ cycle: 'initial', search: '  ', page: '1' })).toEqual({});
  });
});

describe('obligationTotal', () => {
  it('adds up the four counts, which do not overlap', () => {
    expect(obligationTotal(health.counts)).toBe(18);
  });
});

describe('sharePercent', () => {
  it('rounds down, so a share never reads 100% while one is left', () => {
    expect(sharePercent(199, 200)).toBe(99);
    expect(sharePercent(1, 3)).toBe(33);
  });

  it('is 0 of nothing', () => {
    expect(sharePercent(0, 0)).toBe(0);
  });
});

describe('matchingRows', () => {
  it('keeps every row, in the order counted, without a search', () => {
    expect(matchingRows(progress().reportingEntities, undefined)).toEqual([
      health,
      publicService,
      treasury,
      none,
    ]);
  });

  it('keeps the reporting entities whose name holds the search, in any case', () => {
    expect(matchingRows(progress().reportingEntities, 'MINISTRY')).toEqual([health]);
    expect(matchingRows(progress().reportingEntities, 'the')).toEqual([treasury]);
  });

  it('never matches declarants with no reporting entity', () => {
    expect(matchingRows(progress().reportingEntities, 'no reporting')).toEqual([]);
  });
});

describe('progressTotals', () => {
  it("is the endpoint's own total without a search", () => {
    const counted = progress();
    expect(progressTotals(counted, undefined)).toEqual({ counts: counted.total, matching: null });
  });

  it('adds up the matching reporting entities when searching', () => {
    expect(progressTotals(progress(), 'state department')).toEqual({
      counts: { notStarted: 0, inProgress: 2, submitted: 0, late: 3 },
      matching: 1,
    });
  });
});

describe('hasProgress', () => {
  it('is whether the cycle counts any obligation', () => {
    expect(hasProgress(progress())).toBe(true);
    expect(
      hasProgress({
        ...progress([]),
        total: { notStarted: 0, inProgress: 0, submitted: 0, late: 0 },
      }),
    ).toBe(false);
  });
});

describe('progressPage', () => {
  const rows = Array.from({ length: PROGRESS_PAGE_SIZE + 3 }, (_, i) => row(`Entity ${i}`));

  it('shows the page asked for, clamped to the pages there are', () => {
    expect(progressPage(rows, undefined)).toMatchObject({
      page: 1,
      pages: 2,
      from: 1,
      to: PROGRESS_PAGE_SIZE,
    });
    const last = progressPage(rows, 9);
    expect(last).toMatchObject({
      page: 2,
      from: PROGRESS_PAGE_SIZE + 1,
      to: PROGRESS_PAGE_SIZE + 3,
    });
    expect(last.rows).toHaveLength(3);
  });
});

describe('progressCycles', () => {
  it('offers the opened cycles and the current one, saying when one not open yet opens', () => {
    const counted = { ...progress(), cycle: cycle('biennial:2027', false) };
    expect(progressCycles(counted)).toEqual([
      { key: 'biennial:2025', label: 'Biennial 2025' },
      { key: 'biennial:2027', label: 'Biennial 2027 (opens 4 Jul 2027)' },
    ]);
  });

  it('keeps the way back to the current cycle when another is counted', () => {
    const unopened = {
      ...progress(),
      cycle: cycle('biennial:2029', false, '2029-07-04'),
      cycles: [cycle('biennial:2027', false), cycle('biennial:2029', false, '2029-07-04')],
    };
    expect(progressCycles(unopened)).toEqual([
      { key: 'biennial:2027', label: 'Biennial 2027 (opens 4 Jul 2027)' },
      { key: 'biennial:2029', label: 'Biennial 2029 (opens 4 Jul 2029)' },
    ]);
  });

  it('adds a cycle asked for that the calendar does not list', () => {
    const unlisted = { ...progress(), cycle: cycle('biennial:1999', false, '1999-07-04') };
    expect(progressCycles(unlisted).map((option) => option.key)).toEqual([
      'biennial:2025',
      'biennial:1999',
    ]);
  });

  it('leaves out cycles after the current one that have not opened', () => {
    expect(progressCycles(progress())).toEqual([{ key: 'biennial:2025', label: 'Biennial 2025' }]);
  });
});
