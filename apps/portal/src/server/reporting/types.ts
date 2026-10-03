import type { components } from './schema';

type Schemas = components['schemas'];

export type OpenDataRelease = Schemas['PublicOpenDataRelease'];
export type OpenDataTableName = Schemas['OpenDataTable'];
export type ReleaseKind = OpenDataRelease['kind'];
export type ProblemDetails = Schemas['ProblemDetails'];

/** The six tables of a release, in the order the API and the page list them. */
export const OPEN_DATA_TABLES = [
  'filing-by-commission',
  'compliance-by-commission',
  'by-entity-type',
  'by-cycle',
  'access-requests',
  'national-totals',
] as const satisfies readonly OpenDataTableName[];

/** Filing cycles: the Form M sections, and `all` for the three together. */
export const CYCLES = ['initial', 'biennial', 'final', 'all'] as const;
export type Cycle = (typeof CYCLES)[number];

/** Where a Commission's Form M stands for the year (reporting.yaml `IntakeStatus`). */
export type ReportStatus = 'not-reported' | 'submitted-on-time' | 'submitted-late';

/**
 * A table row as served. The contract types rows loosely (`additionalProperties`); the shapes
 * below are the reporting service's (#491 `open-data/tables.ts`). Every row is suppressed or
 * published whole: `suppressed: true` with its figures `null`.
 */
export type TableRow = Record<string, string | number | boolean | null>;

interface FilingFigures extends TableRow {
  expected: number | null;
  filed: number | null;
  nonFilers: number | null;
  /** filed / expected to four decimals; null when nothing was expected. */
  filingRate: number | null;
  suppressed: boolean;
}

export interface FilingByCommissionRow extends FilingFigures {
  commission: string;
  commissionName: string;
  reportStatus: ReportStatus;
  cycle: Cycle;
}

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

export interface ByEntityTypeRow extends FilingFigures {
  entityType: string;
  cycle: Cycle;
}

export interface ByCycleRow extends FilingFigures {
  cycle: Cycle;
}

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

export interface NationalTotalsRow extends TableRow {
  measure: NationalMeasure;
  value: number | null;
  suppressed: boolean;
}

/** A table as `getOpenDataTable` serves it in JSON. */
export interface OpenDataTable<Row extends TableRow = TableRow> {
  table: OpenDataTableName;
  columns: string[];
  rows: Row[];
  suppression: { threshold: number; cellsSuppressed: number };
  notCollected: string[];
}

export interface ReleaseTables {
  'filing-by-commission': OpenDataTable<FilingByCommissionRow>;
  'compliance-by-commission': OpenDataTable<ComplianceByCommissionRow>;
  'by-entity-type': OpenDataTable<ByEntityTypeRow>;
  'by-cycle': OpenDataTable<ByCycleRow>;
  'access-requests': OpenDataTable<AccessRequestsRow>;
  'national-totals': OpenDataTable<NationalTotalsRow>;
}

/**
 * A table read with its row type: the service builds every table of a name with the same
 * columns (#491 `tables.ts`), and the contract leaves rows open. Throws on a table of another
 * name than the one asked for.
 */
export function readTable<Name extends OpenDataTableName>(
  body: Schemas['OpenDataTableBody'],
  name: Name,
): ReleaseTables[Name] {
  if (body.table !== name) throw new Error(`Asked for ${name}, read ${body.table}`);
  return body as unknown as ReleaseTables[Name];
}
