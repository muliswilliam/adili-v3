import type { FormMV1 } from '@adili/forms';

import type { components } from './api.gen';

type Schemas = components['schemas'];

export type ReportStatus = Schemas['ReportStatus'];
export type ReportCounts = Schemas['ReportCounts'];
/** reporting.yaml `ComplianceReportSummary`: one financial year of the period selector. */
export type ReportPeriod = Schemas['ComplianceReportSummary'];
export type Officer = Schemas['Officer'];

/**
 * reporting.yaml `ComplianceReport`, with its document typed as the form-m.v1 document it is (the
 * contract names only its parts: a draft need not be complete against the schema yet).
 */
export type ComplianceReport = Omit<Schemas['ComplianceReport'], 'document'> & {
  document: FormMV1 | null;
};

/** The reporting service's problem details, with the registered `code` the console acts on. */
export interface ReportingProblem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** A `PROBLEM_CODES` code (api-kit), e.g. `preview-not-available` or `report-submitted`. */
  code?: Schemas['ProblemDetails']['code'];
  /** Field-level errors, e.g. the form-m.v1 paths an `incomplete` report has still to fill. */
  errors?: Schemas['ProblemDetails']['errors'];
}
