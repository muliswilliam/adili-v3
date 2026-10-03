import type { CommissionFacts } from '../directory/directory-client.js';
import type { ReportCounts } from '../compliance-reports/schema.js';
import {
  INTAKE_SECTIONS,
  type IntakeSection,
  type IntakeStatus,
  intakeStatusOf,
  rateOf,
  type ReceiptFacts,
  statusCounts,
} from '../compliance-reports/intake.js';

/**
 * The national consolidated report's numbers (spec 09 NCR): aggregates over the Commissions'
 * submitted reports as filed (EACC's receipts), recomputed at every build. National totals per
 * Form M section with rates, the year's reporting (on time, late, not reported), and a row per
 * Commission keyed by its slug. Counts, rates, slugs and Commission names only: never an
 * officer.
 *
 * Every number sits at a stable dot path (`national.initial.rate`,
 * `byCommission.psc.final.declared`; see `aggregatePaths`). Spec 09b's narrative paragraphs
 * (`aggregateRefs`) and pattern candidates (`aggregateKeys`) do not cite these paths: they cite
 * aggregate keys in the ai-gateway scheme (`national.<name>`, `commission.<code>.<name>`,
 * prefixed `fy<fy>.`), built from these aggregates by #326 and #334.
 */

/** A Form M section's counts with its declared rate (declared / expected; null for none). */
export interface SectionAggregate {
  expected: number;
  declared: number;
  notDeclared: number;
  rate: number | null;
}

export interface AccessAggregate {
  received: number;
  granted: number;
  declined: number;
}

/** A Commission's row: its report's status and, once submitted, its numbers. */
export interface CommissionAggregate {
  name: string;
  status: IntakeStatus;
  reportId: string | null;
  reference: string | null;
  submittedAt: string | null;
  /** Null until the Commission reports. */
  initial: SectionAggregate | null;
  biennial: (SectionAggregate & { noCycleInPeriod: boolean }) | null;
  final: SectionAggregate | null;
  clarifications: number | null;
  accessRequests: AccessAggregate | null;
}

export interface NationalAggregates extends Record<string, unknown> {
  fy: number;
  reporting: {
    commissions: number;
    reported: number;
    onTime: number;
    late: number;
    notReported: number;
    /** Reported over Commissions; null when there are none. */
    rate: number | null;
  };
  national: {
    initial: SectionAggregate;
    biennial: SectionAggregate;
    final: SectionAggregate;
    /** The three sections together. */
    all: SectionAggregate;
    clarifications: number;
    accessRequests: AccessAggregate;
  };
  byCommission: Record<string, CommissionAggregate>;
}

/**
 * The aggregates of the year from the directory's active Commissions and EACC's receipts of the
 * submitted reports. A Commission that filed but is no longer listed still counts.
 */
export function buildAggregates(input: {
  fy: number;
  commissions: readonly CommissionFacts[];
  receipts: readonly ReceiptFacts[];
}): NationalAggregates {
  const names = new Map(input.commissions.map((commission) => [commission.slug, commission.name]));
  for (const receipt of input.receipts) {
    if (!names.has(receipt.tenant)) names.set(receipt.tenant, receipt.tenant.toUpperCase());
  }
  const receipts = new Map(input.receipts.map((receipt) => [receipt.tenant, receipt]));

  const totals = {
    initial: emptySection(),
    biennial: emptySection(),
    final: emptySection(),
    clarifications: 0,
    accessRequests: { received: 0, granted: 0, declined: 0 },
  };
  const byCommission: Record<string, CommissionAggregate> = {};
  for (const slug of [...names.keys()].sort()) {
    const name = names.get(slug) ?? slug;
    const receipt = receipts.get(slug);
    if (!receipt) {
      byCommission[slug] = {
        name,
        status: intakeStatusOf(undefined),
        reportId: null,
        reference: null,
        submittedAt: null,
        initial: null,
        biennial: null,
        final: null,
        clarifications: null,
        accessRequests: null,
      };
      continue;
    }
    const counts = receipt.counts;
    for (const section of INTAKE_SECTIONS) add(totals[section], sectionOf(counts, section));
    const clarifications = numberOr0(counts.clarifications);
    const access = accessOf(counts);
    totals.clarifications += clarifications;
    totals.accessRequests.received += access.received;
    totals.accessRequests.granted += access.granted;
    totals.accessRequests.declined += access.declined;
    byCommission[slug] = {
      name,
      status: intakeStatusOf(receipt),
      reportId: receipt.reportId,
      reference: receipt.reference,
      submittedAt: receipt.submittedAt.toISOString(),
      initial: withRate(sectionOf(counts, 'initial')),
      biennial: {
        ...withRate(sectionOf(counts, 'biennial')),
        noCycleInPeriod: counts.biennial.noCycleInPeriod,
      },
      final: withRate(sectionOf(counts, 'final')),
      clarifications,
      accessRequests: access,
    };
  }

  const all = emptySection();
  for (const section of INTAKE_SECTIONS) add(all, totals[section]);
  const rows = Object.values(byCommission);
  const { onTime, late, notReported } = statusCounts(rows.map((row) => row.status));
  return {
    fy: input.fy,
    reporting: {
      commissions: rows.length,
      reported: onTime + late,
      onTime,
      late,
      notReported,
      rate: rateOf(onTime + late, rows.length),
    },
    national: {
      initial: withRate(totals.initial),
      biennial: withRate(totals.biennial),
      final: withRate(totals.final),
      all: withRate(all),
      clarifications: totals.clarifications,
      accessRequests: totals.accessRequests,
    },
    byCommission,
  };
}

/**
 * Every number's dot path in `aggregates`, sorted (`national.initial.rate`,
 * `byCommission.psc.final.declared`...). A rate that is null (nothing expected) is still a path.
 * These are not aggregate keys, which narrative paragraphs and pattern candidates cite: those
 * are in the ai-gateway scheme, and building them is #326 and #334's work.
 */
export function aggregatePaths(aggregates: NationalAggregates): string[] {
  const paths: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'number' || (value === null && path.endsWith('.rate'))) {
      paths.push(path);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
    }
  };
  visit({ reporting: aggregates.reporting, national: aggregates.national }, '');
  visit({ byCommission: aggregates.byCommission }, '');
  return paths.sort();
}

interface Counts {
  expected: number;
  declared: number;
  notDeclared: number;
}

function emptySection(): Counts {
  return { expected: 0, declared: 0, notDeclared: 0 };
}

function add(total: Counts, counts: Counts): void {
  total.expected += counts.expected;
  total.declared += counts.declared;
  total.notDeclared += counts.notDeclared;
}

function withRate(counts: Counts): SectionAggregate {
  return { ...counts, rate: rateOf(counts.declared, counts.expected) };
}

/** A section's counts as filed; a count the report lacks is 0. */
function sectionOf(counts: ReportCounts, section: IntakeSection): Counts {
  const found = counts[section] as Partial<Counts> | undefined;
  return {
    expected: numberOr0(found?.expected),
    declared: numberOr0(found?.declared),
    notDeclared: numberOr0(found?.notDeclared),
  };
}

function accessOf(counts: ReportCounts): AccessAggregate {
  const found = counts.accessRequests as Partial<AccessAggregate> | undefined;
  return {
    received: numberOr0(found?.received),
    granted: numberOr0(found?.granted),
    declined: numberOr0(found?.declined),
  };
}

function numberOr0(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
