import { describe, expect, it } from 'vitest';

import type {
  CommissionAggregate,
  NarrativeParagraph,
  NationalAggregates,
  PatternCandidate,
  SectionAggregate,
} from '../../server/reporting/types';
import { candidateCard, citedCandidateIds, figureFormatter, figureTarget } from './patterns';

const counts = (expected: number, declared: number): SectionAggregate => ({
  expected,
  declared,
  notDeclared: expected - declared,
  rate: expected > 0 ? declared / expected : null,
});

function reported(
  name: string,
  status: 'submitted-on-time' | 'submitted-late',
  biennial: [number, number],
  clarifications: number,
): CommissionAggregate {
  return {
    name,
    status,
    reportId: null,
    reference: null,
    submittedAt: null,
    initial: counts(0, 0),
    biennial: { ...counts(...biennial), noCycleInPeriod: false },
    final: counts(0, 0),
    clarifications,
    accessRequests: null,
  };
}

/** FY 2025/2026: two Commissions reported, one did not. */
const AGGREGATES: NationalAggregates = {
  fy: 2025,
  reporting: { commissions: 3, reported: 2, onTime: 1, late: 1, notReported: 1, rate: 0.6667 },
  national: {
    initial: counts(0, 0),
    biennial: counts(3000, 2700),
    final: counts(0, 0),
    all: counts(3000, 2700),
    clarifications: 27,
    accessRequests: { received: 0, granted: 0, declined: 0 },
  },
  byCommission: {
    cpsbnairobicity: reported(
      'Nairobi City County Public Service Board',
      'submitted-late',
      [2000, 1800],
      18,
    ),
    psc: reported('Public Service Commission', 'submitted-on-time', [1000, 900], 9),
    cpsbmandera: {
      name: 'Mandera County Public Service Board',
      status: 'not-reported',
      reportId: null,
      reference: null,
      submittedAt: null,
      initial: null,
      biennial: null,
      final: null,
      clarifications: null,
      accessRequests: null,
    },
  },
};

const candidate = (overrides: Partial<PatternCandidate>): PatternCandidate => ({
  id: 'x',
  kind: 'rate-change',
  subject: 'cpsbnairobicity',
  values: {},
  aggregateKeys: ['commission.cpsbnairobicity.nonFilerRate'],
  ...overrides,
});

describe('a pattern card from its candidate', () => {
  it('names the Commission and states a rate change against last year', () => {
    expect(
      candidateCard(
        candidate({ values: { from: 0.0412, to: 0.1, change: 0.0588, factor: 2.43 } }),
        AGGREGATES,
      ),
    ).toEqual({
      kind: 'rate-change',
      subject: 'Nairobi City County Public Service Board',
      value: '10%',
      valueLabel: 'non-filer rate',
      comparison: 'from 4.1% in 2024/2025, 2.4 times',
    });
  });

  it('says how many times lower a rate that fell is', () => {
    expect(
      candidateCard(
        candidate({ values: { from: 0.2, to: 0.08, change: -0.12, factor: 0.4 } }),
        AGGREGATES,
      ).comparison,
    ).toBe('from 20% in 2024/2025, 2.5 times lower');
  });

  it('calls the nation National', () => {
    expect(
      candidateCard(
        candidate({
          kind: 'threshold-breach',
          subject: 'national',
          values: { nonFilerRate: 0.1234, threshold: 0.1 },
        }),
        AGGREGATES,
      ),
    ).toEqual({
      kind: 'threshold-breach',
      subject: 'National',
      value: '12.3%',
      valueLabel: 'non-filer rate',
      comparison: 'threshold 10%',
    });
  });

  it('lists the years of a late-reporting run, oldest first', () => {
    expect(
      candidateCard(
        candidate({ kind: 'chronic-late-reporting', subject: 'psc', values: { years: 3 } }),
        AGGREGATES,
      ),
    ).toEqual({
      kind: 'chronic-late-reporting',
      subject: 'Public Service Commission',
      value: '3 years',
      valueLabel: 'reported late running',
      comparison: '2023/2024, 2024/2025 and 2025/2026',
    });
  });

  it('puts clarification ratios per 1,000 declarations', () => {
    expect(
      candidateCard(
        candidate({
          kind: 'clarification-ratio-outlier',
          values: { clarificationRatio: 0.0426, nationalRatio: 0.0121, factor: 3.52 },
        }),
        AGGREGATES,
      ),
    ).toMatchObject({
      value: '42.6',
      valueLabel: 'clarifications per 1,000 declarations',
      comparison: 'national 12.1, 3.5 times',
    });
  });

  it('compares a size-band outlier with its peers, open-ended band or not', () => {
    const outlier = (bandTo: number | null) =>
      candidateCard(
        candidate({
          kind: 'size-band-outlier',
          values: { nonFilerRate: 0.24, peerNonFilerRate: 0.082, peers: 6, bandFrom: 1000, bandTo },
        }),
        AGGREGATES,
      );
    expect(outlier(null)).toMatchObject({
      value: '24%',
      valueLabel: 'non-filer rate',
      comparison: '8.2% for the 6 others with 1,000 officers or more',
    });
    expect(outlier(4999).comparison).toBe('8.2% for the 6 others with 1,000 to 4,999 officers');
  });

  it('counts the years without a Form M, one year in the singular', () => {
    expect(
      candidateCard(
        candidate({ kind: 'non-reporting', subject: 'cpsbmandera', values: { years: 1 } }),
        AGGREGATES,
      ),
    ).toEqual({
      kind: 'non-reporting',
      subject: 'Mandera County Public Service Board',
      value: '1 year',
      valueLabel: 'without a Form M',
      comparison: '2025/2026',
    });
  });

  it('says a figure the candidate lacks is not available, not 0', () => {
    expect(
      candidateCard(candidate({ values: { from: 0.0412, factor: null } }), AGGREGATES),
    ).toMatchObject({ value: 'not available', comparison: 'from 4.1% in 2024/2025' });
    expect(
      candidateCard(candidate({ kind: 'non-reporting', values: {} }), AGGREGATES),
    ).toMatchObject({ value: 'not available', comparison: '' });
  });

  it('shows a slug it has no name for as it is', () => {
    expect(candidateCard(candidate({ subject: 'gone', values: {} }), AGGREGATES).subject).toBe(
      'gone',
    );
  });
});

describe('figures cited by aggregate key', () => {
  const format = figureFormatter(AGGREGATES, [
    candidate({
      aggregateKeys: [
        'fy2025.commission.cpsbnairobicity.nonFilerRate',
        'commission.cpsbnairobicity.nonFilerRate',
      ],
      values: { from: 0.0412, to: 0.1, change: 0.0588, factor: 2.43 },
    }),
    candidate({
      kind: 'chronic-late-reporting',
      subject: 'psc',
      values: { years: 2 },
      aggregateKeys: ['fy2025.commission.psc.reportedLate', 'commission.psc.reportedLate'],
    }),
  ]);

  it("resolves this year's figures from the report", () => {
    expect(format('national.filingRate')).toEqual({
      label: 'National filing rate 2025/2026',
      value: '90%',
    });
    expect(format('national.commissionsNotReported')).toEqual({
      label: 'Commissions not reported 2025/2026',
      value: '1',
    });
    expect(format('commission.cpsbnairobicity.nonFilerRate')).toEqual({
      label: 'Nairobi City County Public Service Board non-filer rate 2025/2026',
      value: '10%',
    });
    expect(format('commission.psc.clarificationRatio')).toEqual({
      label: 'Public Service Commission clarifications per 1,000 declarations 2025/2026',
      value: '10.0',
    });
    expect(format('commission.cpsbnairobicity.biennialExpected')).toEqual({
      label: 'Nairobi City County Public Service Board biennial declarations expected 2025/2026',
      value: '2,000',
    });
    expect(format('commission.cpsbnairobicity.reportedLate')).toEqual({
      label: 'Nairobi City County Public Service Board reported late 2025/2026',
      value: 'Yes',
    });
  });

  it("reads the nation's totals from the service's own All sections", () => {
    const withAll = {
      ...AGGREGATES,
      national: { ...AGGREGATES.national, all: counts(3100, 2790) },
    };

    expect(figureFormatter(withAll, [])('national.filed')?.value).toBe('2,790');
    expect(figureFormatter(withAll, [])('national.clarificationRatio')?.value).toBe('9.7');
  });

  it('finds no clarification figure for a Commission whose report did not count them', () => {
    const psc = reported('Public Service Commission', 'submitted-on-time', [1000, 900], 0);
    const uncounted = {
      ...AGGREGATES,
      byCommission: { ...AGGREGATES.byCommission, psc: { ...psc, clarifications: null } },
    };
    const formatUncounted = figureFormatter(uncounted, []);

    expect(formatUncounted('commission.psc.clarifications')).toBeNull();
    expect(formatUncounted('commission.psc.clarificationRatio')).toBeNull();
    expect(formatUncounted('commission.psc.filed')?.value).toBe('900');
  });

  it("resolves a prior year's figures from the candidates citing them", () => {
    expect(format('fy2025.commission.cpsbnairobicity.nonFilerRate')).toEqual({
      label: 'Nairobi City County Public Service Board non-filer rate 2024/2025',
      value: '4.1%',
    });
    expect(format('fy2025.commission.psc.reportedLate')).toEqual({
      label: 'Public Service Commission reported late 2024/2025',
      value: 'Yes',
    });
  });

  it('finds nothing for a figure it does not have', () => {
    expect(format('commission.cpsbmandera.nonFilerRate')).toBeNull();
    expect(format('fy2024.national.filingRate')).toBeNull();
    expect(format('commission.nobody.filed')).toBeNull();
    expect(format('national.unknown')).toBeNull();
    expect(format('nonsense')).toBeNull();
  });

  it("points this year's figure at its table row", () => {
    expect(figureTarget('commission.psc.nonFilerRate', 2025)).toEqual({ commission: 'psc' });
    expect(figureTarget('national.biennialFilingRate', 2025)).toEqual({ national: 'biennial' });
    expect(figureTarget('national.nonFilerRate', 2025)).toEqual({ national: 'all' });
    expect(figureTarget('national.commissionsLate', 2025)).toBeNull();
    expect(figureTarget('national.clarificationRatio', 2025)).toBeNull();
    expect(figureTarget('nonsense', 2025)).toBeNull();
  });

  it("has no row on the page for a prior year's figure", () => {
    expect(figureTarget('fy2025.commission.psc.reportedLate', 2025)).toBeNull();
    expect(figureTarget('fy2025.national.nonFilerRate', 2025)).toBeNull();
  });
});

describe('cited candidates', () => {
  const paragraph = (candidateIds: string[]): NarrativeParagraph => ({
    id: crypto.randomUUID(),
    section: 'findings',
    position: 0,
    text: '',
    aiDraft: false,
    aggregateRefs: [],
    candidateIds,
  });

  it('are those any paragraph of the narrative cites', () => {
    expect(citedCandidateIds([paragraph([]), paragraph(['a']), paragraph(['b', 'c'])])).toEqual(
      new Set(['a', 'b', 'c']),
    );
  });
});
