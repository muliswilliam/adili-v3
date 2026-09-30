import { describe, expect, it } from 'vitest';

import type { ReportCounts } from '../../src/compliance-reports/schema.js';
import { aggregateKeys, buildAggregates } from '../../src/national-reports/aggregates.js';
import { receiptOf, reportCounts, section } from '../support/receipts.js';

/**
 * S11 aggregates: national totals per section, the year's reporting and a row per Commission,
 * from EACC's receipts of the submitted reports; every number at a stable dot path.
 */
describe('NCR aggregates', () => {
  /** Counts with `[expected, declared]` initial and biennial sections, one clarification and access request. */
  const counts = (initial: [number, number], biennial: [number, number]): ReportCounts =>
    reportCounts({
      initial: section(...initial),
      biennial: { ...section(...biennial), noCycleInPeriod: false },
      final: section(0, 0),
      clarifications: 1,
      accessRequests: { received: 1, granted: 1, declined: 0 },
    });

  const receipt = (tenant: string, filed: ReportCounts, late = false) =>
    receiptOf(tenant, { late, counts: filed });

  const commissions = [
    { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
    { slug: 'jsc', issuerCode: 'JSC', name: 'Judicial Service Commission' },
  ];

  it('totals the submitted reports per section with rates, and lists every Commission by slug', () => {
    const aggregates = buildAggregates({
      fy: 2027,
      commissions,
      // tsc filed but is no longer listed: it still counts.
      receipts: [
        receipt('psc', counts([10, 9], [3, 1])),
        receipt('tsc', counts([5, 5], [0, 0]), true),
      ],
    });

    expect(aggregates.reporting).toEqual({
      commissions: 3,
      reported: 2,
      onTime: 1,
      late: 1,
      notReported: 1,
      rate: 0.6667,
    });
    expect(aggregates.national.initial).toEqual({
      expected: 15,
      declared: 14,
      notDeclared: 1,
      rate: 0.9333,
    });
    expect(aggregates.national.final).toEqual({
      expected: 0,
      declared: 0,
      notDeclared: 0,
      rate: null,
    });
    expect(aggregates.national.all).toMatchObject({ expected: 18, declared: 15 });
    expect(aggregates.national.accessRequests).toEqual({ received: 2, granted: 2, declined: 0 });
    expect(Object.keys(aggregates.byCommission)).toEqual(['jsc', 'psc', 'tsc']);
    expect(aggregates.byCommission.tsc).toMatchObject({ name: 'TSC', status: 'submitted-late' });
    expect(aggregates.byCommission.jsc).toMatchObject({
      status: 'not-reported',
      initial: null,
      clarifications: null,
    });
  });

  it('names every number by a stable dot path, rates without a denominator included', () => {
    const keys = aggregateKeys(
      buildAggregates({
        fy: 2027,
        commissions,
        receipts: [receipt('psc', counts([10, 9], [3, 1]))],
      }),
    );

    expect(keys).toContain('national.initial.rate');
    expect(keys).toContain('national.final.rate');
    expect(keys).toContain('reporting.notReported');
    expect(keys).toContain('byCommission.psc.biennial.declared');
    expect(keys).toContain('byCommission.psc.accessRequests.granted');
    // Not reported: no numbers.
    expect(keys.some((key) => key.startsWith('byCommission.jsc.'))).toBe(false);
    expect(keys).not.toContain('fy');
    expect([...keys].sort()).toEqual(keys);
  });
});
