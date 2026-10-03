import { INTAKE_SECTIONS, type IntakeStatus, rateOf } from '../compliance-reports/intake.js';
import type { NationalAggregates } from '../national-reports/aggregates.js';
import { ACTION_STEPS, type ActionStep } from '../projections/schema.js';
import { type ReleasedCell, SUPPRESSION_THRESHOLD, suppressTable } from './suppression.js';

/**
 * An open-data release's six tables (spec 09b), built from aggregates in the NCR's shape for
 * everything they carry (filing per Commission and cycle, clarifications issued) and from the
 * projection facts for what they do not (determinations, clarifications resolved, administrative
 * actions, referrals). Pure: aggregates and counts in, suppressed tables and their unsuppressed
 * national totals out. Dimensions never finer than Commission x entity type x cycle; counts and
 * rates only, never an officer.
 *
 * Suppression (`suppressTable`, threshold {@link SUPPRESSION_THRESHOLD}) protects every figure
 * over fewer officers than the threshold, and every row is suppressed or published as a whole
 * (`suppressed: true` with its figures `null`), so one pattern serves all of a row's figures:
 *
 * - Filing is a Commission x cycle table of officers filed out of expected. Its cells are
 *   `filing-by-commission`'s cycle rows, its row totals the Commissions' `all` rows, its column
 *   totals `by-cycle` and its grand total the filing figures of `national-totals`; one
 *   suppression of that table gives all three tables the same pattern, so none reveals a figure
 *   another hides. Expected and non-filers follow filed's pattern.
 * - A Commission's other counts (compliance; access requests once collected) are over its
 *   officers (`all` expected): one Commission-level pattern, suppressed by officers, applies to
 *   every one of them, so each measure's national total hides at least two Commissions or none.
 *
 * Commissions that have not reported for the year have no officer denominator: their rows carry
 * `null` figures, unsuppressed (there is nothing to hide), and their facts count nowhere.
 *
 * Access requests are not collected yet (spec 10 projects them): the `access-requests` figures
 * and the national `accessRequests*` measures are `null`, unsuppressed, and named in the table's
 * `notCollected`, so a consumer never reads "no requests" from a count nobody kept. A Form M's
 * access-request zeros are a placeholder, not data.
 */

export const OPEN_DATA_TABLES = [
  'filing-by-commission',
  'compliance-by-commission',
  'by-entity-type',
  'by-cycle',
  'access-requests',
  'national-totals',
] as const;
/** reporting.yaml `OpenDataTable`. */
export type OpenDataTableName = (typeof OPEN_DATA_TABLES)[number];

/** Filing cycles: the Form M sections, and `all` for the three together. */
export const CYCLES = [...INTAKE_SECTIONS, 'all'] as const;
export type Cycle = (typeof CYCLES)[number];

/** Approved compliance determinations' outcomes (spec 08), in the order the tables list them. */
export const DETERMINATION_OUTCOMES = ['compliant', 'non-compliant', 'further-action'] as const;
export type DeterminationOutcome = (typeof DETERMINATION_OUTCOMES)[number];

/** A table row: dimensions, figures (`null` when suppressed or not reported) and the marker. */
export type TableRow = Record<string, string | number | boolean | null>;

/**
 * A table as released and served (reporting.yaml `getOpenDataTable` JSON): its columns in order,
 * its rows, how many figures suppression hid, and the figures not collected yet: columns, or in
 * `national-totals` measures, whose values are `null` for want of data, not suppression.
 */
export interface OpenDataTable<Row extends TableRow = TableRow> {
  table: OpenDataTableName;
  columns: string[];
  rows: Row[];
  suppression: { threshold: number; cellsSuppressed: number };
  notCollected: string[];
}

/** Officers expected to file, those who filed, those who did not, and filed / expected. */
export interface FilingFigures extends TableRow {
  expected: number | null;
  filed: number | null;
  nonFilers: number | null;
  /** To four decimals; null when nothing was expected. */
  filingRate: number | null;
  suppressed: boolean;
}

/** `filing-by-commission`: a Commission's filing per cycle, with its report's status. */
export interface FilingByCommissionRow extends FilingFigures {
  commission: string;
  commissionName: string;
  reportStatus: IntakeStatus;
  cycle: Cycle;
}

/** `compliance-by-commission`: a Commission's review and enforcement counts for the year. */
export interface ComplianceByCommissionRow extends TableRow {
  commission: string;
  commissionName: string;
  determinationsCompliant: number | null;
  determinationsNonCompliant: number | null;
  determinationsFurtherAction: number | null;
  clarificationsIssued: number | null;
  clarificationsResolved: number | null;
  actionsNoticeToComply: number | null;
  actionsWarning: number | null;
  actionsSalaryStoppage: number | null;
  actionsDisciplinaryReferral: number | null;
  referrals: number | null;
  suppressed: boolean;
}

/**
 * `by-entity-type`: filing per reporting entity type and cycle. No entity types exist in the
 * directory yet, so the table has its columns and no rows.
 */
export interface ByEntityTypeRow extends FilingFigures {
  entityType: string;
  cycle: Cycle;
}

/** `by-cycle`: national filing per cycle. */
export interface ByCycleRow extends FilingFigures {
  cycle: Cycle;
}

/** `access-requests`: a Commission's access requests (Form M section 5); not collected yet. */
export interface AccessRequestsRow extends TableRow {
  commission: string;
  commissionName: string;
  received: number | null;
  granted: number | null;
  declined: number | null;
  suppressed: boolean;
}

export const NATIONAL_MEASURES = [
  'commissions',
  'commissionsReported',
  'commissionsReportedOnTime',
  'commissionsReportedLate',
  'commissionsNotReported',
  'reportingRate',
  'expected',
  'filed',
  'nonFilers',
  'filingRate',
  'clarificationsIssued',
  'clarificationsResolved',
  'determinationsCompliant',
  'determinationsNonCompliant',
  'determinationsFurtherAction',
  'actionsNoticeToComply',
  'actionsWarning',
  'actionsSalaryStoppage',
  'actionsDisciplinaryReferral',
  'referrals',
  'accessRequestsReceived',
  'accessRequestsGranted',
  'accessRequestsDeclined',
] as const;
export type NationalMeasure = (typeof NATIONAL_MEASURES)[number];

/** `national-totals`: one national figure per row. */
export interface NationalTotalsRow extends TableRow {
  measure: NationalMeasure;
  value: number | null;
  suppressed: boolean;
}

export interface ReleaseTables {
  'filing-by-commission': OpenDataTable<FilingByCommissionRow>;
  'compliance-by-commission': OpenDataTable<ComplianceByCommissionRow>;
  'by-entity-type': OpenDataTable<ByEntityTypeRow>;
  'by-cycle': OpenDataTable<ByCycleRow>;
  'access-requests': OpenDataTable<AccessRequestsRow>;
  'national-totals': OpenDataTable<NationalTotalsRow>;
}

/** A Commission's counts for the year from the projection facts. */
export interface ComplianceCounts {
  determinations: Record<DeterminationOutcome, number>;
  clarificationsResolved: number;
  /** Administrative actions issued in the year, by rung of the ladder. */
  actions: Record<ActionStep, number>;
  referrals: number;
}

export interface ReleaseSource {
  /** The aggregates the tables are built from, as the NCR builds them. */
  aggregates: NationalAggregates;
  /** Projection counts by Commission slug; a Commission without any counts zero. */
  compliance: Readonly<Record<string, ComplianceCounts>>;
}

interface SectionTotals {
  expected: number;
  declared: number;
  notDeclared: number;
}

/**
 * The release's national figures before suppression, summed from the rows the tables are built
 * from: what reconciliation compares with the NCR (`reconcile`).
 */
export interface ReleaseTotals {
  reporting: {
    commissions: number;
    reported: number;
    onTime: number;
    late: number;
    notReported: number;
  };
  /** Access requests are not collected yet, so neither published nor reconciled. */
  national: Record<Cycle, SectionTotals> & { clarifications: number };
}

export interface BuiltRelease {
  tables: ReleaseTables;
  totals: ReleaseTotals;
}

export interface ReleaseOptions {
  /** Figures over fewer officers than this are suppressed. Default {@link SUPPRESSION_THRESHOLD}. */
  threshold?: number;
}

export function emptyComplianceCounts(): ComplianceCounts {
  return {
    determinations: { compliant: 0, 'non-compliant': 0, 'further-action': 0 },
    clarificationsResolved: 0,
    actions: {
      'notice-to-comply': 0,
      warning: 0,
      'salary-stoppage': 0,
      'disciplinary-referral': 0,
    },
    referrals: 0,
  };
}

const FILING_COLUMNS = ['expected', 'filed', 'nonFilers', 'filingRate', 'suppressed'] as const;

const COMPLIANCE_MEASURES = [
  'determinationsCompliant',
  'determinationsNonCompliant',
  'determinationsFurtherAction',
  'clarificationsIssued',
  'clarificationsResolved',
  'actionsNoticeToComply',
  'actionsWarning',
  'actionsSalaryStoppage',
  'actionsDisciplinaryReferral',
  'referrals',
] as const;
type ComplianceMeasure = (typeof COMPLIANCE_MEASURES)[number];

const ACCESS_MEASURES = ['received', 'granted', 'declined'] as const;

/** The national measures of access requests, not collected yet like the table's columns. */
const ACCESS_NATIONAL_MEASURES = [
  'accessRequestsReceived',
  'accessRequestsGranted',
  'accessRequestsDeclined',
] as const satisfies readonly NationalMeasure[];

/** A figure not collected yet: null, and never suppressed (there is nothing to hide). */
const NOT_COLLECTED = { value: null, suppressed: false } as const;

const ACTION_MEASURES: Record<ActionStep, ComplianceMeasure> = {
  'notice-to-comply': 'actionsNoticeToComply',
  warning: 'actionsWarning',
  'salary-stoppage': 'actionsSalaryStoppage',
  'disciplinary-referral': 'actionsDisciplinaryReferral',
};

const DETERMINATION_MEASURES: Record<DeterminationOutcome, ComplianceMeasure> = {
  compliant: 'determinationsCompliant',
  'non-compliant': 'determinationsNonCompliant',
  'further-action': 'determinationsFurtherAction',
};

/** A Commission that reported, with its counts as filed and from the facts. */
interface Reported {
  slug: string;
  name: string;
  status: IntakeStatus;
  sections: Record<(typeof INTAKE_SECTIONS)[number], SectionTotals>;
  officers: number;
  compliance: Record<ComplianceMeasure, number>;
}

export function buildReleaseTables(
  source: ReleaseSource,
  options: ReleaseOptions = {},
): BuiltRelease {
  const threshold = options.threshold ?? SUPPRESSION_THRESHOLD;
  const commissions = Object.entries(source.aggregates.byCommission).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const reported: Reported[] = [];
  for (const [slug, row] of commissions) {
    if (!row.initial || !row.biennial || !row.final) continue;
    const sections = {
      initial: countsOf(row.initial),
      biennial: countsOf(row.biennial),
      final: countsOf(row.final),
    };
    const facts = source.compliance[slug] ?? emptyComplianceCounts();
    const compliance = {} as Record<ComplianceMeasure, number>;
    for (const outcome of DETERMINATION_OUTCOMES) {
      compliance[DETERMINATION_MEASURES[outcome]] = facts.determinations[outcome];
    }
    compliance.clarificationsIssued = row.clarifications ?? 0;
    compliance.clarificationsResolved = facts.clarificationsResolved;
    for (const step of ACTION_STEPS) compliance[ACTION_MEASURES[step]] = facts.actions[step];
    compliance.referrals = facts.referrals;
    reported.push({
      slug,
      name: row.name,
      status: row.status,
      sections,
      officers: INTAKE_SECTIONS.reduce((total, section) => total + sections[section].expected, 0),
      compliance,
    });
  }
  const byReported = new Map(reported.map((commission) => [commission.slug, commission]));

  // Filing: Commissions x cycles, officers filed out of expected.
  const filing = suppressTable(
    {
      rows: reported.map((commission) => commission.slug),
      columns: [...INTAKE_SECTIONS],
      cells: reported.map((commission) =>
        INTAKE_SECTIONS.map((section) => ({
          value: commission.sections[section].declared,
          officers: commission.sections[section].expected,
        })),
      ),
    },
    { threshold },
  );
  // Everything else per Commission is over its officers: one pattern by officers.
  const perCommission = suppressTable(
    {
      rows: reported.map((commission) => commission.slug),
      columns: ['officers'],
      cells: reported.map((commission) => [
        { value: commission.officers, officers: commission.officers },
      ]),
    },
    { threshold },
  );

  const national = {} as Record<Cycle, SectionTotals>;
  for (const section of INTAKE_SECTIONS) {
    national[section] = sumOf(reported.map((commission) => commission.sections[section]));
  }
  national.all = sumOf(INTAKE_SECTIONS.map((section) => national[section]));

  // filing-by-commission
  const filingRows: FilingByCommissionRow[] = [];
  for (const [slug, row] of commissions) {
    const r = reported.findIndex((commission) => commission.slug === slug);
    const commission = byReported.get(slug);
    for (const cycle of CYCLES) {
      const dimensions = { commission: slug, commissionName: row.name, reportStatus: row.status };
      if (!commission) {
        filingRows.push({ ...dimensions, cycle, ...NOT_REPORTED_FILING });
        continue;
      }
      const counts =
        cycle === 'all'
          ? sumOf(INTAKE_SECTIONS.map((section) => commission.sections[section]))
          : commission.sections[cycle];
      const cell =
        cycle === 'all' ? filing.rowTotals[r] : filing.cells[r]?.[INTAKE_SECTIONS.indexOf(cycle)];
      filingRows.push({ ...dimensions, cycle, ...filingFigures(counts, cell) });
    }
  }

  // by-cycle
  const byCycleRows: ByCycleRow[] = CYCLES.map((cycle) => ({
    cycle,
    ...filingFigures(
      national[cycle],
      cycle === 'all' ? filing.total : filing.columnTotals[INTAKE_SECTIONS.indexOf(cycle)],
    ),
  }));

  // compliance-by-commission and access-requests
  const complianceRows: ComplianceByCommissionRow[] = [];
  const accessRows: AccessRequestsRow[] = [];
  for (const [slug, row] of commissions) {
    const commission = byReported.get(slug);
    const dimensions = { commission: slug, commissionName: row.name };
    const r = reported.findIndex((candidate) => candidate.slug === slug);
    const suppressed = commission !== undefined && isSuppressed(perCommission.cells[r]?.[0]);
    const published = commission !== undefined && !suppressed;
    complianceRows.push({
      ...dimensions,
      ...figuresOf(COMPLIANCE_MEASURES, published ? commission.compliance : undefined),
      suppressed,
    });
    accessRows.push({ ...dimensions, ...figuresOf(ACCESS_MEASURES, undefined), suppressed: false });
  }

  const complianceTotals = {} as Record<ComplianceMeasure, number>;
  for (const measure of COMPLIANCE_MEASURES) {
    complianceTotals[measure] = reported.reduce((t, c) => t + c.compliance[measure], 0);
  }
  const onTime = commissions.filter(([, row]) => row.status === 'submitted-on-time').length;
  const late = commissions.filter(([, row]) => row.status === 'submitted-late').length;
  const reporting = {
    commissions: commissions.length,
    reported: onTime + late,
    onTime,
    late,
    notReported: commissions.length - onTime - late,
  };

  // national-totals
  const filingTotal = filingFigures(national.all, filing.total);
  const perCommissionTotal = isSuppressed(perCommission.total);
  const counted = (value: number): Pick<NationalTotalsRow, 'value' | 'suppressed'> =>
    perCommissionTotal ? { value: null, suppressed: true } : { value, suppressed: false };
  const open = (value: number | null): Pick<NationalTotalsRow, 'value' | 'suppressed'> => ({
    value,
    suppressed: false,
  });
  const filingMeasure = (
    value: number | null,
  ): Pick<NationalTotalsRow, 'value' | 'suppressed'> => ({
    value,
    suppressed: filingTotal.suppressed,
  });
  const nationalValues: Record<NationalMeasure, Pick<NationalTotalsRow, 'value' | 'suppressed'>> = {
    commissions: open(reporting.commissions),
    commissionsReported: open(reporting.reported),
    commissionsReportedOnTime: open(reporting.onTime),
    commissionsReportedLate: open(reporting.late),
    commissionsNotReported: open(reporting.notReported),
    reportingRate: open(rateOf(reporting.reported, reporting.commissions)),
    expected: filingMeasure(filingTotal.expected),
    filed: filingMeasure(filingTotal.filed),
    nonFilers: filingMeasure(filingTotal.nonFilers),
    filingRate: filingMeasure(filingTotal.filingRate),
    ...Object.fromEntries(
      COMPLIANCE_MEASURES.map((measure) => [measure, counted(complianceTotals[measure])]),
    ),
    ...Object.fromEntries(ACCESS_NATIONAL_MEASURES.map((measure) => [measure, NOT_COLLECTED])),
  } as Record<NationalMeasure, Pick<NationalTotalsRow, 'value' | 'suppressed'>>;
  const nationalRows: NationalTotalsRow[] = NATIONAL_MEASURES.map((measure) => ({
    measure,
    ...nationalValues[measure],
  }));

  const tables: ReleaseTables = {
    'filing-by-commission': tableOf(
      'filing-by-commission',
      ['commission', 'commissionName', 'reportStatus', 'cycle', ...FILING_COLUMNS],
      filingRows,
      threshold,
    ),
    'compliance-by-commission': tableOf(
      'compliance-by-commission',
      ['commission', 'commissionName', ...COMPLIANCE_MEASURES, 'suppressed'],
      complianceRows,
      threshold,
    ),
    'by-entity-type': tableOf<ByEntityTypeRow>(
      'by-entity-type',
      ['entityType', 'cycle', ...FILING_COLUMNS],
      [],
      threshold,
    ),
    'by-cycle': tableOf('by-cycle', ['cycle', ...FILING_COLUMNS], byCycleRows, threshold),
    'access-requests': tableOf(
      'access-requests',
      ['commission', 'commissionName', ...ACCESS_MEASURES, 'suppressed'],
      accessRows,
      threshold,
      ACCESS_MEASURES,
    ),
    'national-totals': tableOf(
      'national-totals',
      ['measure', 'value', 'suppressed'],
      nationalRows,
      threshold,
      ACCESS_NATIONAL_MEASURES,
    ),
  };

  return {
    tables,
    totals: {
      reporting,
      national: { ...national, clarifications: complianceTotals.clarificationsIssued },
    },
  };
}

/**
 * Reconciliation (spec 09b S9): the release's national figures against the national totals of
 * the aggregates it was built from (the NCR's, or the live projections' for a snapshot of a year
 * without one). The dot paths (`national.initial.declared`, `reporting.late`) whose counts
 * differ; empty when the release reconciles. Rates follow from the counts and are not compared;
 * access requests are not collected, so not compared either. Built from the same aggregates, the
 * tables reconcile unless the table builder lost or double-counted a figure.
 */
export function reconcile(totals: ReleaseTotals, ncr: NationalAggregates): string[] {
  const expected = {
    reporting: {
      commissions: ncr.reporting.commissions,
      reported: ncr.reporting.reported,
      onTime: ncr.reporting.onTime,
      late: ncr.reporting.late,
      notReported: ncr.reporting.notReported,
    },
    national: {
      ...Object.fromEntries(CYCLES.map((cycle) => [cycle, countsOf(ncr.national[cycle])])),
      clarifications: ncr.national.clarifications,
    },
  };
  const mismatches: string[] = [];
  const compare = (actual: unknown, wanted: unknown, path: string): void => {
    if (typeof wanted === 'object' && wanted !== null) {
      for (const [key, child] of Object.entries(wanted)) {
        compare((actual as Record<string, unknown> | undefined)?.[key], child, `${path}.${key}`);
      }
    } else if (actual !== wanted) {
      mismatches.push(path.slice(1));
    }
  };
  compare(totals, expected, '');
  return mismatches;
}

/** The figures a filing row shows for a Commission that has not reported. */
const NOT_REPORTED_FILING = {
  expected: null,
  filed: null,
  nonFilers: null,
  filingRate: null,
  suppressed: false,
} as const;

function filingFigures(counts: SectionTotals, cell: ReleasedCell | undefined): FilingFigures {
  if (isSuppressed(cell)) {
    return { expected: null, filed: null, nonFilers: null, filingRate: null, suppressed: true };
  }
  return {
    expected: counts.expected,
    filed: counts.declared,
    nonFilers: counts.notDeclared,
    filingRate: rateOf(counts.declared, counts.expected),
    suppressed: false,
  };
}

function figuresOf<M extends string>(
  measures: readonly M[],
  values: Record<M, number> | undefined,
): Record<M, number | null> {
  return Object.fromEntries(
    measures.map((measure) => [measure, values ? values[measure] : null]),
  ) as Record<M, number | null>;
}

/** A cell the table does not have (an empty table's) is not suppressed. */
function isSuppressed(cell: ReleasedCell | undefined): boolean {
  return cell?.suppressed ?? false;
}

function countsOf(section: SectionTotals): SectionTotals {
  return {
    expected: section.expected,
    declared: section.declared,
    notDeclared: section.notDeclared,
  };
}

function sumOf(sections: readonly SectionTotals[]): SectionTotals {
  return sections.reduce(
    (total, section) => ({
      expected: total.expected + section.expected,
      declared: total.declared + section.declared,
      notDeclared: total.notDeclared + section.notDeclared,
    }),
    { expected: 0, declared: 0, notDeclared: 0 },
  );
}

/**
 * The table with its columns in order. `notCollected` names the figures not collected yet (their
 * columns, or `national-totals` measures): never counted as suppressed.
 */
function tableOf<Row extends TableRow>(
  table: OpenDataTableName,
  columns: (keyof Row & string)[],
  rows: Row[],
  threshold: number,
  notCollected: readonly string[] = [],
): OpenDataTable<Row> {
  const figures = columns.filter(
    (column) => isFigure(column) && !notCollected.includes(column),
  ).length;
  const ordered = rows.map(
    (row) => Object.fromEntries(columns.map((column) => [column, row[column]])) as unknown as Row,
  );
  return {
    table,
    columns,
    rows: ordered,
    suppression: {
      threshold,
      cellsSuppressed: rows.filter((row) => row.suppressed === true).length * figures,
    },
    notCollected: [...notCollected],
  };
}

/** Dimension columns and the marker; every other column is a figure. */
const DIMENSIONS = new Set([
  'commission',
  'commissionName',
  'reportStatus',
  'cycle',
  'entityType',
  'measure',
  'suppressed',
]);

function isFigure(column: string): boolean {
  return !DIMENSIONS.has(column);
}
