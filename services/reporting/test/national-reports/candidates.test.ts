import { describe, expect, it } from 'vitest';

import { envSchema } from '../../src/config.js';
import { buildAggregates, type NationalAggregates } from '../../src/national-reports/aggregates.js';
import {
  type CandidateThresholds,
  historyYears,
  patternCandidates,
} from '../../src/national-reports/candidates.js';
import {
  aggregateKeys,
  narrativeFigures,
  narrativeYear,
} from '../../src/national-reports/narrative-input.js';
import { CANDIDATE_THRESHOLDS } from '../../src/national-reports/national-report-store.js';
import {
  FY2027_CANDIDATES,
  HISTORY,
  HISTORY_COMMISSIONS,
  type HistoryFy,
} from '../support/ncr-history.js';
import { receiptOf } from '../support/receipts.js';

/**
 * S1 pattern candidates, pure, on golden fixtures (`ncr-history.ts`): a Commission whose non-filer
 * rate doubled, a three-year late reporter and a clarification outlier, among others, with the
 * expected kinds, values and aggregate keys; the thresholds configurable.
 */
describe('NCR pattern candidates (S1)', () => {
  const aggregatesOf = (fy: HistoryFy): NationalAggregates =>
    buildAggregates({
      fy,
      commissions: HISTORY_COMMISSIONS,
      receipts: HISTORY[fy].map((each) => receiptOf(each.tenant, each)),
    });

  const figures2027 = () =>
    narrativeFigures(aggregatesOf(2027), [aggregatesOf(2025), aggregatesOf(2026)]);

  const thresholds = (overrides: Partial<CandidateThresholds> = {}): CandidateThresholds => ({
    ...CANDIDATE_THRESHOLDS,
    ...overrides,
  });

  it('S1: finds the doubled non-filer rate, the three-year late reporter and the clarification outlier, with their values and keys', () => {
    expect(patternCandidates(figures2027(), thresholds())).toEqual(FY2027_CANDIDATES);
  });

  it('S1: cites only keys of figures the narrative input carries', () => {
    const figures = figures2027();
    const keys = aggregateKeys(figures);
    for (const candidate of patternCandidates(figures, thresholds())) {
      expect(candidate.aggregateKeys.length).toBeGreaterThan(0);
      for (const key of candidate.aggregateKeys) expect(keys).toContain(key);
    }
  });

  it('S1: defaults to the documented thresholds', () => {
    expect(CANDIDATE_THRESHOLDS).toEqual({
      minPoints: 0.02,
      rateChangeFactor: 2,
      maxNonFilerRate: 0.1,
      chronicLateYears: 3,
      clarificationRatioFactor: 2,
      sizeBands: [100, 1000],
      sizeBandFactor: 2,
    });
  });

  it('S1: reads the size bands from configuration as ascending whole numbers', () => {
    const bands = envSchema.shape.CANDIDATE_SIZE_BANDS;
    expect(bands.parse(undefined)).toEqual([100, 1000]);
    expect(bands.parse('50, 500,5000')).toEqual([50, 500, 5000]);
    expect(bands.parse('')).toEqual([]);
    expect(bands.safeParse('500,50').success).toBe(false);
    expect(bands.safeParse('100,ten').success).toBe(false);
  });

  it('S1: follows the configured thresholds', () => {
    const ids = (overrides: Partial<CandidateThresholds>) =>
      patternCandidates(figures2027(), thresholds(overrides)).map((each) => each.id);

    // The doubling falls short of a tripling; a 4.75-point move falls short of 5 points.
    expect(ids({ rateChangeFactor: 3 })).not.toContain('rate-change:tsc:nonFilerRate');
    expect(ids({ minPoints: 0.05 })).not.toContain('rate-change:tsc:nonFilerRate');
    // 12% is within 15%; at 5%, the Teachers Service Commission's 8.75% and the nation's 6.9% breach.
    expect(ids({ maxNonFilerRate: 0.15 })).not.toContain('threshold-breach:npsc:nonFilerRate');
    expect(ids({ maxNonFilerRate: 0.05 })).toEqual(
      expect.arrayContaining([
        'threshold-breach:national:nonFilerRate',
        'threshold-breach:npsc:nonFilerRate',
        'threshold-breach:tsc:nonFilerRate',
      ]),
    );
    // Three late years are not four.
    expect(ids({ chronicLateYears: 4 })).not.toContain('chronic-late-reporting:cra:reportedLate');
    // 5.27 times the national ratio is under 6.
    expect(ids({ clarificationRatioFactor: 6 })).not.toContain(
      'clarification-ratio-outlier:jsc:clarificationRatio',
    );
    // One band for all: 5% is well under the 6.9% of the rest; 2.5 times the band is under 3.
    expect(ids({ sizeBands: [] })).not.toContain('size-band-outlier:cra:nonFilerRate');
    expect(ids({ sizeBandFactor: 3 })).not.toContain('size-band-outlier:cra:nonFilerRate');
  });

  it('S1: lists the largest of each kind first, the nation before a Commission only on a tie', () => {
    const breaches = patternCandidates(figures2027(), thresholds({ maxNonFilerRate: 0.05 }))
      .filter((each) => each.kind === 'threshold-breach')
      .map((each) => [each.subject, each.values.nonFilerRate]);
    expect(breaches).toEqual([
      ['npsc', 0.12],
      ['tsc', 0.0875],
      ['national', 0.069],
    ]);
    // Rate changes by points either way: tsc's 4.75 before the nation's 2.68.
    const changes = patternCandidates(figures2027(), thresholds({ rateChangeFactor: 1.5 }))
      .filter((each) => each.kind === 'rate-change')
      .map((each) => [each.subject, each.values.change]);
    expect(changes).toEqual([
      ['tsc', 0.0475],
      ['national', 0.0268],
    ]);
  });

  it('S1: looks back as many years as a chronic late reporter needs', () => {
    expect(historyYears(thresholds())).toBe(2);
    expect(historyYears(thresholds({ chronicLateYears: 5 }))).toBe(4);
  });

  it('S1: a year without aggregates breaks a run, and no prior year means no change', () => {
    const lone = narrativeFigures(aggregatesOf(2027), []);
    const ids = patternCandidates(lone, thresholds()).map((each) => each.id);
    expect(ids).not.toContain('rate-change:tsc:nonFilerRate');
    expect(ids).not.toContain('chronic-late-reporting:cra:reportedLate');
    expect(ids).toContain('non-reporting:nlc:reported');

    // FY 2026 never built: FY 2025 is not the year before.
    const gap = narrativeFigures(aggregatesOf(2027), [aggregatesOf(2025)]);
    expect(patternCandidates(gap, thresholds()).map((each) => each.kind)).not.toContain(
      'rate-change',
    );
  });

  it('S1: counts the years a Commission has not reported, cited by year', () => {
    const silent = buildAggregates({ fy: 2027, commissions: HISTORY_COMMISSIONS, receipts: [] });
    const before = buildAggregates({ fy: 2026, commissions: HISTORY_COMMISSIONS, receipts: [] });
    const [candidate] = patternCandidates(narrativeFigures(silent, [before]), thresholds()).filter(
      (each) => each.subject === 'psc',
    );
    expect(candidate).toEqual({
      id: 'non-reporting:psc:reported',
      kind: 'non-reporting',
      subject: 'psc',
      values: { years: 2 },
      aggregateKeys: ['commission.psc.reported', 'fy2027.commission.psc.reported'],
    });
  });
});

/** The aggregates in the ai-gateway's `narrate-compliance-report` shape, shared with the draft. */
describe('NCR narrative input', () => {
  const aggregates = buildAggregates({
    fy: 2027,
    commissions: HISTORY_COMMISSIONS,
    receipts: HISTORY[2027].map((each) => receiptOf(each.tenant, each)),
  });

  it('sends the year by the calendar year it ends in, with named totals and fractional rates', () => {
    const year = narrativeYear(aggregates);
    expect(year.fy).toBe(2028);
    expect(year.totals).toMatchObject({
      commissions: 7,
      commissionsReported: 6,
      commissionsLate: 1,
      commissionsNotReported: 1,
      expected: 15170,
      filed: 14123,
      nonFilers: 1047,
      clarifications: 425,
    });
    expect(year.rates).toMatchObject({
      reportingRate: 0.8571,
      filingRate: 0.931,
      nonFilerRate: 0.069,
      initialFilingRate: null,
      clarificationRatio: 0.0301,
    });
    expect(Object.keys(year.totals)).not.toContain('accessRequestsReceived');
  });

  it('gives a row per Commission by slug; one that did not report has only `reported`', () => {
    const { commissionTable } = narrativeYear(aggregates);
    expect(commissionTable.map((row) => row.code)).toEqual([
      'cra',
      'jsc',
      'nlc',
      'npsc',
      'psc',
      'src',
      'tsc',
    ]);
    const cra = commissionTable.find((row) => row.code === 'cra');
    expect(cra).toMatchObject({
      commissionName: 'Commission on Revenue Allocation',
      figures: { reported: 1, reportedLate: 1, expected: 120, filed: 114, nonFilerRate: 0.05 },
    });
    const nlc = commissionTable.find((row) => row.code === 'nlc');
    expect(Object.entries(nlc?.figures ?? {}).filter(([, value]) => value !== null)).toEqual([
      ['reported', 0],
    ]);
  });

  it('keys prior-year figures by their gateway year, most recent first', () => {
    const before = buildAggregates({ fy: 2026, commissions: HISTORY_COMMISSIONS, receipts: [] });
    const older = buildAggregates({ fy: 2025, commissions: HISTORY_COMMISSIONS, receipts: [] });
    // A year not before this one is ignored.
    const figures = narrativeFigures(aggregates, [older, aggregates, before]);
    expect(figures.priorYears.map((year) => year.fy)).toEqual([2027, 2026]);
    const keys = aggregateKeys(figures);
    expect(keys).toContain('national.nonFilerRate');
    expect(keys).toContain('commission.tsc.filed');
    expect(keys).toContain('fy2027.national.filed');
    expect(keys).toContain('fy2026.commission.psc.reported');
    expect(keys).not.toContain('fy2028.national.filed');
  });
});
