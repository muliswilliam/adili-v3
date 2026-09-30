import type { CommissionFacts } from '../directory/directory-client.js';
import type { ReportCounts } from './schema.js';

/**
 * EACC's intake of compliance reports for a financial year (spec 09): every active Commission
 * with its report's status (not reported, submitted on time, submitted late), its headline rates
 * per section from the counts of the report as filed, outliers against configured thresholds,
 * and how often it was chased. Pure functions over identifiers, counts and dates.
 */

/** reporting.yaml `IntakeStatus`. */
export type IntakeStatus = 'not-reported' | 'submitted-on-time' | 'submitted-late';

export const INTAKE_SECTIONS = ['initial', 'biennial', 'final'] as const;
export type IntakeSection = (typeof INTAKE_SECTIONS)[number];

/** reporting.yaml `Intake` outliers. */
// No "declared, none expected": hosted declared derives from expected; federated rules refuse it.
export type Outlier =
  'low-initial-rate' | 'low-biennial-rate' | 'low-final-rate' | 'section-missing';

/** The lowest declared rate (declared / expected) per section before a report is an outlier. */
export type RateThresholds = Record<IntakeSection, number>;

export interface SectionRate {
  expected: number;
  declared: number;
  /** declared / expected, to four decimals; null when nothing was expected. */
  rate: number | null;
}

/** EACC's receipt of a submitted report (`report_receipts`). */
export interface ReceiptFacts {
  reportId: string;
  tenant: string;
  reference: string;
  submittedAt: Date;
  late: boolean;
  counts: ReportCounts;
  formMDocumentId: string | null;
  receiptDocumentId: string | null;
}

/** The chases of a Commission for the year. */
export interface ChaseFacts {
  tenant: string;
  count: number;
  lastAt: Date | null;
}

export interface IntakeItem {
  commission: { slug: string; name: string };
  status: IntakeStatus;
  reportId: string | null;
  reference: string | null;
  submittedAt: string | null;
  rates: Partial<Record<IntakeSection, SectionRate>>;
  outliers: Outlier[];
  chases: { count: number; lastAt: string | null };
  formMDocumentId: string | null;
  receiptDocumentId: string | null;
}

/** reporting.yaml `Intake`. */
export interface IntakeView {
  fy: number;
  totals: {
    onTime: number;
    late: number;
    notReported: number;
    nationalDeclaredRate: number | null;
  };
  commissions: IntakeItem[];
}

export interface IntakeFilters {
  status?: IntakeStatus;
  outliersOnly?: boolean;
}

/** A Commission's status for the year from EACC's receipt of its report, if any. */
export function intakeStatusOf(receipt: { late: boolean } | undefined): IntakeStatus {
  if (!receipt) return 'not-reported';
  return receipt.late ? 'submitted-late' : 'submitted-on-time';
}

/** How many of `statuses` are on time, late and not reported. */
export function statusCounts(statuses: readonly IntakeStatus[]): {
  onTime: number;
  late: number;
  notReported: number;
} {
  const count = (status: IntakeStatus) => statuses.filter((found) => found === status).length;
  return {
    onTime: count('submitted-on-time'),
    late: count('submitted-late'),
    notReported: count('not-reported'),
  };
}

/** declared / expected to four decimals; null when nothing was expected. */
export function rateOf(declared: number, expected: number): number | null {
  return expected > 0 ? Math.round((declared / expected) * 10_000) / 10_000 : null;
}

/** The rates per section of a report's counts; a section the counts lack is left out. */
export function sectionRates(
  counts: Partial<ReportCounts>,
): Partial<Record<IntakeSection, SectionRate>> {
  const rates: Partial<Record<IntakeSection, SectionRate>> = {};
  for (const section of INTAKE_SECTIONS) {
    const found = sectionCounts(counts, section);
    if (!found) continue;
    rates[section] = {
      expected: found.expected,
      declared: found.declared,
      rate: rateOf(found.declared, found.expected),
    };
  }
  return rates;
}

/**
 * What stands out in a report's counts:
 *
 * - `low-<section>-rate`: officers were expected to declare and the declared rate is below the
 *   section's threshold;
 * - `section-missing`: a section's counts are absent, or no officer in service is expected to
 *   declare in a year with a biennial cycle (the in-service section left empty).
 */
export function outliersOf(counts: Partial<ReportCounts>, thresholds: RateThresholds): Outlier[] {
  const outliers = new Set<Outlier>();
  for (const section of INTAKE_SECTIONS) {
    const found = sectionCounts(counts, section);
    if (!found) {
      outliers.add('section-missing');
      continue;
    }
    const rate = rateOf(found.declared, found.expected);
    if (rate !== null && rate < thresholds[section]) outliers.add(`low-${section}-rate`);
  }
  const biennial = counts.biennial;
  if (biennial && !biennial.noCycleInPeriod && biennial.expected === 0) {
    outliers.add('section-missing');
  }
  const order: Outlier[] = [
    'low-initial-rate',
    'low-biennial-rate',
    'low-final-rate',
    'section-missing',
  ];
  return order.filter((outlier) => outliers.has(outlier));
}

/**
 * The year's intake: every Commission the directory lists (and any other that filed a receipt),
 * by name, with the national totals over the submitted reports. `filters` narrow the list, not
 * the totals.
 */
export function buildIntake(input: {
  fy: number;
  commissions: readonly CommissionFacts[];
  receipts: readonly ReceiptFacts[];
  chases: readonly ChaseFacts[];
  thresholds: RateThresholds;
  filters?: IntakeFilters;
}): IntakeView {
  const receipts = new Map(input.receipts.map((receipt) => [receipt.tenant, receipt]));
  const chases = new Map(input.chases.map((chase) => [chase.tenant, chase]));
  const names = new Map(input.commissions.map((commission) => [commission.slug, commission.name]));
  for (const receipt of input.receipts) {
    if (!names.has(receipt.tenant)) names.set(receipt.tenant, receipt.tenant.toUpperCase());
  }

  const items: IntakeItem[] = [...names]
    .sort(([slugA, a], [slugB, b]) => a.localeCompare(b) || slugA.localeCompare(slugB))
    .map(([slug, name]) => {
      const receipt = receipts.get(slug);
      const chase = chases.get(slug);
      return {
        commission: { slug, name },
        status: intakeStatusOf(receipt),
        reportId: receipt?.reportId ?? null,
        reference: receipt?.reference ?? null,
        submittedAt: receipt?.submittedAt.toISOString() ?? null,
        rates: receipt ? sectionRates(receipt.counts) : {},
        outliers: receipt ? outliersOf(receipt.counts, input.thresholds) : [],
        chases: { count: chase?.count ?? 0, lastAt: chase?.lastAt?.toISOString() ?? null },
        formMDocumentId: receipt?.formMDocumentId ?? null,
        receiptDocumentId: receipt?.receiptDocumentId ?? null,
      };
    });

  let declared = 0;
  let expected = 0;
  for (const receipt of input.receipts) {
    for (const section of INTAKE_SECTIONS) {
      const found = sectionCounts(receipt.counts, section);
      if (!found) continue;
      declared += found.declared;
      expected += found.expected;
    }
  }
  const { status, outliersOnly = false } = input.filters ?? {};
  return {
    fy: input.fy,
    totals: {
      ...statusCounts(items.map((item) => item.status)),
      nationalDeclaredRate: rateOf(declared, expected),
    },
    commissions: items.filter(
      (item) =>
        (status === undefined || item.status === status) &&
        (!outliersOnly || item.outliers.length > 0),
    ),
  };
}

/** A section's counts when the report has them as numbers. */
function sectionCounts(
  counts: Partial<ReportCounts>,
  section: IntakeSection,
): { expected: number; declared: number } | null {
  const found = counts[section] as Partial<ReportCounts[IntakeSection]> | undefined;
  if (typeof found?.expected !== 'number' || typeof found.declared !== 'number') return null;
  return { expected: found.expected, declared: found.declared };
}
