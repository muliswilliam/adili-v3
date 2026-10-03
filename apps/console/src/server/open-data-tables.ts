import { z } from 'zod';

/**
 * An open-data release's six tables as the reporting service builds them (#491
 * `services/reporting/src/open-data/tables.ts`). reporting.yaml leaves each table's rows open, so
 * the console reads them with these schemas: a row that is not what was built reads as a failed
 * load, never as a wrong figure. Shared by the loader, the page and the mock; not a `.server`
 * module, so the page may import it.
 */

/** reporting.yaml `OpenDataTable`, in the order the release page lists them. */
export const OPEN_DATA_TABLES = [
  'filing-by-commission',
  'compliance-by-commission',
  'by-entity-type',
  'by-cycle',
  'access-requests',
  'national-totals',
] as const;
export type OpenDataTableKey = (typeof OPEN_DATA_TABLES)[number];

/** Filing cycles: the Form M sections, and `all` for the three together. */
export const CYCLES = ['initial', 'biennial', 'final', 'all'] as const;
export type Cycle = (typeof CYCLES)[number];

const figure = z.number().nullable();

const filingFigures = {
  expected: figure,
  filed: figure,
  nonFilers: figure,
  /** To four decimals; null when nothing was expected, suppressed or not reported. */
  filingRate: figure,
  suppressed: z.boolean(),
};

export const FILING_FIGURES = ['expected', 'filed', 'nonFilers', 'filingRate'] as const;

const filingByCommissionRow = z.object({
  commission: z.string(),
  commissionName: z.string(),
  reportStatus: z.enum(['not-reported', 'submitted-on-time', 'submitted-late']),
  cycle: z.enum(CYCLES),
  ...filingFigures,
});

/** `compliance-by-commission`'s figures, in the order the table shows them. */
export const COMPLIANCE_FIGURES = [
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
export type ComplianceFigure = (typeof COMPLIANCE_FIGURES)[number];

const complianceByCommissionRow = z.object({
  commission: z.string(),
  commissionName: z.string(),
  ...(Object.fromEntries(COMPLIANCE_FIGURES.map((name) => [name, figure])) as Record<
    ComplianceFigure,
    typeof figure
  >),
  suppressed: z.boolean(),
});

const byEntityTypeRow = z.object({
  entityType: z.string(),
  cycle: z.enum(CYCLES),
  ...filingFigures,
});

const byCycleRow = z.object({ cycle: z.enum(CYCLES), ...filingFigures });

/** `access-requests`' figures. */
export const ACCESS_REQUEST_FIGURES = ['received', 'granted', 'declined'] as const;

const accessRequestsRow = z.object({
  commission: z.string(),
  commissionName: z.string(),
  received: figure,
  granted: figure,
  declined: figure,
  suppressed: z.boolean(),
});

/** `national-totals`' measures, in the order the table lists them. */
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

const nationalTotalsRow = z.object({
  measure: z.enum(NATIONAL_MEASURES),
  value: figure,
  suppressed: z.boolean(),
});

export const OPEN_DATA_ROW_SCHEMAS = {
  'filing-by-commission': filingByCommissionRow,
  'compliance-by-commission': complianceByCommissionRow,
  'by-entity-type': byEntityTypeRow,
  'by-cycle': byCycleRow,
  'access-requests': accessRequestsRow,
  'national-totals': nationalTotalsRow,
} as const satisfies Record<OpenDataTableKey, z.ZodType>;

export type OpenDataRow<K extends OpenDataTableKey> = z.infer<(typeof OPEN_DATA_ROW_SCHEMAS)[K]>;
export type FilingByCommissionRow = OpenDataRow<'filing-by-commission'>;
export type ComplianceByCommissionRow = OpenDataRow<'compliance-by-commission'>;
export type ByEntityTypeRow = OpenDataRow<'by-entity-type'>;
export type ByCycleRow = OpenDataRow<'by-cycle'>;
export type AccessRequestsRow = OpenDataRow<'access-requests'>;
export type NationalTotalsRow = OpenDataRow<'national-totals'>;

/** A table as read: its rows checked, its suppression and the figures not collected yet. */
export interface ReadTable<K extends OpenDataTableKey> {
  table: K;
  rows: OpenDataRow<K>[];
  suppression: { threshold: number; cellsSuppressed: number };
  /** Columns, or in `national-totals` measures, null for want of data, not suppression. */
  notCollected: string[];
}

export type ReadTables = { [K in OpenDataTableKey]: ReadTable<K> };
