import { describe, expect, it } from 'vitest';

import {
  buildIntake,
  outliersOf,
  rateOf,
  sectionRates,
} from '../../src/compliance-reports/intake.js';
import type { ReportCounts } from '../../src/compliance-reports/schema.js';
import { receiptOf, reportCounts } from '../support/receipts.js';

/**
 * S9 at the unit seam: EACC's intake of a financial year from the receipts of submitted reports,
 * the directory's Commissions and the chases: statuses, rates per section, outliers against the
 * configured thresholds, national totals and filters.
 */
const THRESHOLDS = { initial: 0.8, biennial: 0.9, final: 0.8 };

/** EACC's receipt of `tenant`'s report, `late` or on time, with `filed` counts. */
const receipt = (tenant: string, late: boolean, filed = reportCounts()) =>
  receiptOf(tenant, { late, counts: filed });

const COMMISSIONS = [
  { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
  { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' },
  { slug: 'jsc', issuerCode: 'JSC', name: 'Judicial Service Commission' },
];

describe('EACC intake', () => {
  it('rates are declared over expected to four decimals, null when nothing was expected', () => {
    expect(rateOf(10, 12)).toBe(0.8333);
    expect(rateOf(0, 0)).toBeNull();
    expect(sectionRates(reportCounts())).toEqual({
      initial: { expected: 12, declared: 10, rate: 0.8333 },
      biennial: { expected: 100, declared: 95, rate: 0.95 },
      final: { expected: 4, declared: 4, rate: 1 },
    });
  });

  it('flags a section whose declared rate is below its threshold', () => {
    expect(outliersOf(reportCounts(), THRESHOLDS)).toEqual([]);
    expect(
      outliersOf(
        reportCounts({
          initial: { expected: 10, declared: 7, notDeclared: 3 },
          final: { expected: 4, declared: 3, notDeclared: 1 },
        }),
        THRESHOLDS,
      ),
    ).toEqual(['low-initial-rate', 'low-final-rate']);
    expect(
      outliersOf(
        reportCounts({
          biennial: { expected: 100, declared: 89, notDeclared: 11, noCycleInPeriod: false },
        }),
        THRESHOLDS,
      ),
    ).toEqual(['low-biennial-rate']);
  });

  it('flags missing sections', () => {
    const withoutFinal: Partial<ReportCounts> = reportCounts();
    delete withoutFinal.final;
    expect(outliersOf(withoutFinal, THRESHOLDS)).toEqual(['section-missing']);
    // No officer in service expected to declare in a year with a biennial cycle.
    expect(
      outliersOf(
        reportCounts({
          biennial: { expected: 0, declared: 0, notDeclared: 0, noCycleInPeriod: false },
        }),
        THRESHOLDS,
      ),
    ).toEqual(['section-missing']);
    // A year without a cycle expects none: nothing stands out.
    expect(
      outliersOf(
        reportCounts({
          biennial: { expected: 0, declared: 0, notDeclared: 0, noCycleInPeriod: true },
        }),
        THRESHOLDS,
      ),
    ).toEqual([]);
  });

  it('S9: lists every Commission by name with its status, rates, outliers and chases, and the national totals', () => {
    const intake = buildIntake({
      fy: 2027,
      commissions: COMMISSIONS,
      receipts: [
        receipt(
          'psc',
          false,
          reportCounts({ final: { expected: 4, declared: 3, notDeclared: 1 } }),
        ),
        receipt('tsc', true),
      ],
      chases: [{ tenant: 'jsc', count: 2, lastAt: new Date('2028-08-08T06:00:00.000Z') }],
      thresholds: THRESHOLDS,
    });

    expect(intake.totals).toEqual({
      onTime: 1,
      late: 1,
      notReported: 1,
      // (10 + 95 + 3) + (10 + 95 + 4) declared of 2 x 116 expected.
      nationalDeclaredRate: 0.9353,
    });
    expect(intake.commissions.map((item) => [item.commission.slug, item.status])).toEqual([
      ['jsc', 'not-reported'],
      ['psc', 'submitted-on-time'],
      ['tsc', 'submitted-late'],
    ]);
    expect(intake.commissions[0]).toEqual({
      commission: { slug: 'jsc', name: 'Judicial Service Commission' },
      status: 'not-reported',
      reportId: null,
      reference: null,
      submittedAt: null,
      rates: {},
      outliers: [],
      chases: { count: 2, lastAt: '2028-08-08T06:00:00.000Z' },
      formMDocumentId: null,
      receiptDocumentId: null,
    });
    expect(intake.commissions[1]).toMatchObject({
      reference: 'RPT-PSC-2027-0000001-4',
      submittedAt: '2028-07-20T07:00:00.000Z',
      rates: { final: { expected: 4, declared: 3, rate: 0.75 } },
      outliers: ['low-final-rate'],
      chases: { count: 0, lastAt: null },
    });
    expect(intake.commissions[2]?.outliers).toEqual([]);
  });

  it('filters by status and outliers, keeping the totals of the year', () => {
    const input = {
      fy: 2027,
      commissions: COMMISSIONS,
      receipts: [
        receipt(
          'psc',
          false,
          reportCounts({ final: { expected: 4, declared: 3, notDeclared: 1 } }),
        ),
        receipt('tsc', true),
      ],
      chases: [],
      thresholds: THRESHOLDS,
    };

    const late = buildIntake({ ...input, filters: { status: 'submitted-late' } });
    expect(late.commissions.map((item) => item.commission.slug)).toEqual(['tsc']);
    expect(late.totals.notReported).toBe(1);
    const outliers = buildIntake({ ...input, filters: { outliersOnly: true } });
    expect(outliers.commissions.map((item) => item.commission.slug)).toEqual(['psc']);
  });

  it('lists a Commission that filed but is not in the directory list, and no rate without reports', () => {
    const intake = buildIntake({
      fy: 2027,
      commissions: [],
      receipts: [receipt('ncc', false)],
      chases: [],
      thresholds: THRESHOLDS,
    });
    expect(intake.commissions.map((item) => item.commission)).toEqual([
      { slug: 'ncc', name: 'NCC' },
    ]);
    expect(
      buildIntake({
        fy: 2027,
        commissions: COMMISSIONS,
        receipts: [],
        chases: [],
        thresholds: THRESHOLDS,
      }).totals.nationalDeclaredRate,
    ).toBeNull();
  });
});
