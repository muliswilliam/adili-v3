import type { CommissionFacts } from '../../src/directory/directory-client.js';
import type { ReportCounts } from '../../src/compliance-reports/schema.js';
import { reportCounts, section } from './receipts.js';

/**
 * Three years of submitted reports, FY 2025 to FY 2027, for spec 09b S1 (pattern candidates):
 * in FY 2027 the Teachers Service Commission's non-filer rate doubles (4% to 8.75%), the
 * Commission on Revenue Allocation reports late for the third year running and files at 5% non-filers
 * against 2% in its size band, the Judicial Service Commission's clarification ratio is five times
 * the national, the National Police Service Commission's non-filer rate breaches 10% and the
 * National Land Commission does not report. Everything else is unremarkable. Figures invented.
 */

export const HISTORY_FYS = [2025, 2026, 2027] as const;
export type HistoryFy = (typeof HISTORY_FYS)[number];

export const HISTORY_COMMISSIONS: readonly CommissionFacts[] = [
  { slug: 'cra', issuerCode: 'CRA', name: 'Commission on Revenue Allocation' },
  { slug: 'jsc', issuerCode: 'JSC', name: 'Judicial Service Commission' },
  { slug: 'nlc', issuerCode: 'NLC', name: 'National Land Commission' },
  { slug: 'npsc', issuerCode: 'NPSC', name: 'National Police Service Commission' },
  { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
  { slug: 'src', issuerCode: 'SRC', name: 'Salaries and Remuneration Commission' },
  { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' },
];

export interface HistoryReport {
  tenant: string;
  late: boolean;
  counts: ReportCounts;
}

/** Biennial declarations only: `filed` of `expected`, and the clarifications issued. */
function filing(expected: number, filed: number, clarifications: number): ReportCounts {
  return reportCounts({
    initial: section(0, 0),
    biennial: { ...section(expected, filed), noCycleInPeriod: false },
    final: section(0, 0),
    clarifications,
  });
}

const report = (tenant: string, counts: ReportCounts, late = false): HistoryReport => ({
  tenant,
  late,
  counts,
});

/** The reports submitted for each year. */
export const HISTORY: Readonly<Record<HistoryFy, readonly HistoryReport[]>> = {
  2025: [
    report('cra', filing(120, 114, 2), true),
    report('jsc', filing(900, 882, 18)),
    report('nlc', filing(300, 294, 6)),
    report('npsc', filing(2000, 1780, 40)),
    report('psc', filing(4000, 3920, 80)),
    report('src', filing(150, 147, 3)),
    report('tsc', filing(8000, 7680, 160)),
  ],
  2026: [
    report('cra', filing(120, 114, 2), true),
    report('jsc', filing(900, 882, 18)),
    report('nlc', filing(300, 294, 6)),
    report('npsc', filing(2000, 1780, 40)),
    report('psc', filing(4000, 3920, 80)),
    report('src', filing(150, 147, 3)),
    report('tsc', filing(8000, 7680, 160)),
  ],
  2027: [
    report('cra', filing(120, 114, 2), true),
    report('jsc', filing(900, 882, 140)),
    report('npsc', filing(2000, 1760, 40)),
    report('psc', filing(4000, 3920, 80)),
    report('src', filing(150, 147, 3)),
    report('tsc', filing(8000, 7300, 160)),
  ],
};

/** The candidates FY 2027 yields at the default thresholds (reporting.yaml `PatternCandidate`). */
export const FY2027_CANDIDATES = [
  {
    id: 'rate-change:tsc:nonFilerRate',
    kind: 'rate-change',
    subject: 'tsc',
    values: { from: 0.04, to: 0.0875, change: 0.0475, factor: 2.19 },
    aggregateKeys: ['fy2027.commission.tsc.nonFilerRate', 'commission.tsc.nonFilerRate'],
  },
  {
    id: 'threshold-breach:npsc:nonFilerRate',
    kind: 'threshold-breach',
    subject: 'npsc',
    values: { nonFilerRate: 0.12, threshold: 0.1 },
    aggregateKeys: ['commission.npsc.nonFilerRate'],
  },
  {
    id: 'chronic-late-reporting:cra:reportedLate',
    kind: 'chronic-late-reporting',
    subject: 'cra',
    values: { years: 3 },
    aggregateKeys: [
      'commission.cra.reportedLate',
      'fy2027.commission.cra.reportedLate',
      'fy2026.commission.cra.reportedLate',
    ],
  },
  {
    id: 'clarification-ratio-outlier:jsc:clarificationRatio',
    kind: 'clarification-ratio-outlier',
    subject: 'jsc',
    values: { clarificationRatio: 0.1587, nationalRatio: 0.0301, factor: 5.27 },
    aggregateKeys: ['commission.jsc.clarificationRatio', 'national.clarificationRatio'],
  },
  {
    id: 'size-band-outlier:cra:nonFilerRate',
    kind: 'size-band-outlier',
    subject: 'cra',
    values: { nonFilerRate: 0.05, peerNonFilerRate: 0.02, peers: 2, bandFrom: 100, bandTo: 999 },
    aggregateKeys: ['commission.cra.nonFilerRate', 'commission.cra.expected'],
  },
  {
    id: 'non-reporting:nlc:reported',
    kind: 'non-reporting',
    subject: 'nlc',
    values: { years: 1 },
    aggregateKeys: ['commission.nlc.reported'],
  },
] as const;
