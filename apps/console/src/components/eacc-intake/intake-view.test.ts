import { describe, expect, it } from 'vitest';

import type { Intake, IntakeRow } from '../../server/reporting/types';
import {
  awaitingReports,
  daysLate,
  defaultFinancialYear,
  filterIntake,
  financialYears,
  intakeCounts,
  nextChaseOn,
} from './intake-view';

function line(
  slug: string,
  name: string,
  status: IntakeRow['status'],
  extra: Partial<IntakeRow> = {},
): IntakeRow {
  return {
    commission: { slug, name },
    status,
    reportId: null,
    reference: null,
    submittedAt: null,
    rates: {},
    outliers: [],
    chases: { count: 0, lastAt: null },
    formMDocumentId: null,
    receiptDocumentId: null,
    ...extra,
  };
}

const ROWS: IntakeRow[] = [
  line('jsc', 'Judicial Service Commission', 'not-reported', {
    chases: { count: 10, lastAt: '2026-10-03T03:00:00.000Z' },
  }),
  line('psc', 'Public Service Commission', 'submitted-on-time', {
    reference: 'RPT-PSC-2026-0000001-K',
    outliers: ['low-final-rate'],
  }),
  line('tsc', 'Teachers Service Commission', 'submitted-late', {
    reference: 'RPT-TSC-2026-0000001-K',
    chases: { count: 2, lastAt: '2026-08-08T03:00:00.000Z' },
  }),
  line('cpsb047', 'Nairobi City County Public Service Board', 'submitted-late', {
    outliers: ['low-biennial-rate'],
  }),
];

const intakeOf = (rows: IntakeRow[], fy = 2025): Intake => ({
  fy,
  totals: {
    onTime: rows.filter((row) => row.status === 'submitted-on-time').length,
    late: rows.filter((row) => row.status === 'submitted-late').length,
    notReported: rows.filter((row) => row.status === 'not-reported').length,
    nationalDeclaredRate: null,
  },
  commissions: rows,
});

const slugs = (rows: IntakeRow[]) => rows.map((row) => row.commission.slug);

describe('financial years on the intake', () => {
  it('opens the last year that ended, whose reports are due or in', () => {
    expect(defaultFinancialYear('2026-10-03')).toBe(2025);
    expect(defaultFinancialYear('2026-06-30')).toBe(2025);
  });

  it('opens the current year while no year has ended since the platform started', () => {
    expect(defaultFinancialYear('2025-09-01')).toBe(2025);
  });

  it('lists every year since 2025, newest first, marking the current one', () => {
    expect(financialYears('2026-10-03')).toEqual([
      { fy: 2026, current: true, dueDate: '2027-07-31' },
      { fy: 2025, current: false, dueDate: '2026-07-31' },
    ]);
  });
});

describe('the intake filters', () => {
  it('keeps every Commission without filters', () => {
    expect(slugs(filterIntake(ROWS, {}))).toEqual(['jsc', 'psc', 'tsc', 'cpsb047']);
  });

  it('narrows by status, outliers and a search on the name or reference', () => {
    expect(slugs(filterIntake(ROWS, { status: 'submitted-late' }))).toEqual(['tsc', 'cpsb047']);
    expect(slugs(filterIntake(ROWS, { outliers: true }))).toEqual(['psc', 'cpsb047']);
    expect(slugs(filterIntake(ROWS, { status: 'submitted-late', outliers: true }))).toEqual([
      'cpsb047',
    ]);
    expect(slugs(filterIntake(ROWS, { q: 'nairobi' }))).toEqual(['cpsb047']);
    expect(slugs(filterIntake(ROWS, { q: 'rpt-tsc' }))).toEqual(['tsc']);
    expect(slugs(filterIntake(ROWS, { q: 'Anti-Doping' }))).toEqual([]);
  });

  it('counts each status and the outliers over the whole year, whatever is shown', () => {
    expect(intakeCounts(ROWS)).toEqual({
      all: 4,
      'submitted-on-time': 1,
      'submitted-late': 2,
      'not-reported': 1,
      outliers: 2,
    });
  });
});

describe('the chase and the deadline', () => {
  it('expects the next weekly chase a week after the last while someone has not reported', () => {
    expect(nextChaseOn(intakeOf(ROWS), '2026-10-03')).toBe('2026-10-10');
  });

  it('expects none once everyone reported, or when the chase has stopped', () => {
    expect(nextChaseOn(intakeOf(ROWS.slice(1)), '2026-10-03')).toBeNull();
    expect(nextChaseOn(intakeOf(ROWS), '2026-10-20')).toBeNull();
    expect(nextChaseOn(intakeOf([line('jsc', 'JSC', 'not-reported')]), '2026-10-03')).toBeNull();
  });

  it('waits for reports while none is in and the year is not yet due', () => {
    const none = intakeOf([line('jsc', 'JSC', 'not-reported')], 2026);
    expect(awaitingReports(none, '2026-10-03')).toBe(true);
    expect(awaitingReports(intakeOf(ROWS, 2026), '2026-10-03')).toBe(false);
    expect(awaitingReports(intakeOf([line('jsc', 'JSC', 'not-reported')]), '2026-10-03')).toBe(
      false,
    );
  });

  it('counts the days a report came in after 31 July, in Nairobi', () => {
    expect(daysLate('2026-08-12T12:20:00.000Z', '2026-07-31')).toBe(12);
    // 23:30 in Nairobi on 31 July is still on time.
    expect(daysLate('2026-07-31T20:30:00.000Z', '2026-07-31')).toBe(0);
    expect(daysLate('2026-07-28T08:00:00.000Z', '2026-07-31')).toBe(0);
  });
});
