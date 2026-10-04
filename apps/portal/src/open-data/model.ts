import type { UnshownFigureKind } from '@adili/ui';

import type {
  ComplianceByCommissionRow,
  NationalMeasure,
  NationalTotalsRow,
  ReleaseTables,
  ReportStatus,
} from '../server/reporting/types';
import type { Language } from './copy';

/**
 * What the Open data page derives from a release's tables (spec 09b FE-4): the headline
 * figures, each Commission's rates for the chart, and how a figure that is not shown reads.
 * Pure. Rates in the files are fractions to four decimals; the page shows percentages.
 */

const PERCENT = new Intl.NumberFormat('en-KE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * A fraction as a percentage to exactly one decimal place: `0.8317` → `83.2%`, `0.95` → `95.0%`.
 * Unlike `formatPercent` (`@adili/ui`, a percentage, up to one decimal), it takes the files'
 * fractions and keeps the decimal so rates line up in a column.
 */
export function formatRate(fraction: number): string {
  return `${PERCENT.format(fraction * 100)}%`;
}

/** A start year as its financial year: `2025` → `FY 2025/26`. */
export function financialYear(fy: number): string {
  return `FY ${String(fy)}/${String(fy + 1).slice(2)}`;
}

/** A start year as a short label for an axis: `2025` → `2025/26`. */
export function financialYearShort(fy: number): string {
  return `${String(fy)}/${String(fy + 1).slice(2)}`;
}

const MONTHS: Record<Language, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
};
const NAIROBI_DAY = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  timeZone: 'Africa/Nairobi',
});

/**
 * A date as Nairobi's calendar day, `18 Sep 2026` (`18 Sep 2026` in Swahili too, `3 Okt 2025`).
 * Built from parts so the server and every browser print the same.
 */
export function formatDay(time: string, language: Language): string {
  const parts = NAIROBI_DAY.formatToParts(new Date(time));
  const part = (type: string) => Number(parts.find((each) => each.type === type)?.value);
  return `${String(part('day'))} ${MONTHS[language][part('month') - 1] ?? ''} ${String(part('year'))}`;
}

/** A national measure's value, or null when it is not shown or not collected. */
export function measureOf(
  rows: readonly NationalTotalsRow[],
  measure: NationalMeasure,
): number | null {
  const row = rows.find((each) => each.measure === measure);
  return row && !row.suppressed ? row.value : null;
}

/** Compliant determinations over all determinations; null with none, or when not shown. */
export function complianceRate(figures: {
  compliant: number | null;
  nonCompliant: number | null;
  furtherAction: number | null;
}): number | null {
  const { compliant, nonCompliant, furtherAction } = figures;
  if (compliant === null || nonCompliant === null || furtherAction === null) return null;
  const all = compliant + nonCompliant + furtherAction;
  return all === 0 ? null : Math.round((compliant / all) * 10000) / 10000;
}

export interface Headline {
  filingRate: number | null;
  commissionsReported: number | null;
  commissions: number | null;
  filed: number | null;
  expected: number | null;
  complianceRate: number | null;
  determinations: number | null;
  referrals: number | null;
  actions: number | null;
}

const sum = (values: (number | null)[]) =>
  values.some((value) => value === null) ? null : values.reduce<number>((a, b) => a + (b ?? 0), 0);

/** The four tiles' figures, from the release's national totals. */
export function headline(rows: readonly NationalTotalsRow[]): Headline {
  const m = (measure: NationalMeasure) => measureOf(rows, measure);
  const compliant = m('determinationsCompliant');
  const nonCompliant = m('determinationsNonCompliant');
  const furtherAction = m('determinationsFurtherAction');
  return {
    filingRate: m('filingRate'),
    commissionsReported: m('commissionsReported'),
    commissions: m('commissions'),
    filed: m('filed'),
    expected: m('expected'),
    complianceRate: complianceRate({ compliant, nonCompliant, furtherAction }),
    determinations: sum([compliant, nonCompliant, furtherAction]),
    referrals: m('referrals'),
    actions: sum([
      m('actionsNoticeToComply'),
      m('actionsWarning'),
      m('actionsSalaryStoppage'),
      m('actionsDisciplinaryReferral'),
    ]),
  };
}

export type ChartMetric = 'filing' | 'compliance';

/** A Commission's bar: its rate, or why there is none. */
export interface CommissionBar {
  commission: string;
  name: string;
  /** A fraction; null when not drawn (see `gap`). */
  rate: number | null;
  gap: Extract<UnshownFigureKind, 'suppressed' | 'not-reported'> | null;
}

export function complianceRateOfRow(row: ComplianceByCommissionRow): number | null {
  return complianceRate({
    compliant: row.determinationsCompliant,
    nonCompliant: row.determinationsNonCompliant,
    furtherAction: row.determinationsFurtherAction,
  });
}

/** Each Commission's Form M status, which only the filing table carries. */
export function reportStatuses(tables: ReleaseTables): Map<string, ReportStatus> {
  return new Map(
    tables['filing-by-commission'].rows.map((row) => [row.commission, row.reportStatus]),
  );
}

/**
 * The chart's bars for a measure: every Commission with its rate over all cycles, sorted by
 * rate (`desc` highest first), then those not drawn (suppressed, not reported) by name.
 * Commissions that reported with no compliance determinations have no compliance rate and are
 * left out of that chart.
 */
export function commissionBars(
  tables: ReleaseTables,
  metric: ChartMetric,
  order: 'desc' | 'asc',
): CommissionBar[] {
  const statuses = reportStatuses(tables);
  const bars: CommissionBar[] =
    metric === 'filing'
      ? tables['filing-by-commission'].rows
          .filter((row) => row.cycle === 'all')
          .map((row) => ({
            commission: row.commission,
            name: row.commissionName,
            rate: row.filingRate,
            gap: row.suppressed
              ? 'suppressed'
              : row.reportStatus === 'not-reported'
                ? 'not-reported'
                : null,
          }))
      : tables['compliance-by-commission'].rows.map((row) => ({
          commission: row.commission,
          name: row.commissionName,
          rate: complianceRateOfRow(row),
          gap: row.suppressed
            ? 'suppressed'
            : statuses.get(row.commission) === 'not-reported'
              ? 'not-reported'
              : null,
        }));
  const drawn = bars
    .filter((bar) => bar.gap === null && bar.rate !== null)
    .sort(
      (a, b) =>
        (order === 'desc' ? (b.rate ?? 0) - (a.rate ?? 0) : (a.rate ?? 0) - (b.rate ?? 0)) ||
        a.name.localeCompare(b.name),
    );
  const gaps = bars
    .filter((bar) => bar.gap !== null)
    .sort((a, b) =>
      a.gap === b.gap ? a.name.localeCompare(b.name) : a.gap === 'suppressed' ? -1 : 1,
    );
  return [...drawn, ...gaps];
}
