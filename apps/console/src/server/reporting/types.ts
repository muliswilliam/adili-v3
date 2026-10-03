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
}

/** EACC's referrals intake (spec 09 S12). */
export type ReferralIntakeItem = Schemas['ReferralIntakeItem'];
export type ReferralIntakePage = Schemas['ReferralIntakePage'];
export type ReferralGrounds = Schemas['ReferralGrounds'];
export type IcmsStatus = Schemas['IcmsStatus'];
export type IcmsPushError = Schemas['IcmsPushError'];

/** Every `IcmsStatus`, checked against the generated union both ways, in the intake's filter order. */
const ICMS_STATUS_SET = {
  'not-pushed': true,
  pushed: true,
  registered: true,
  'push-failed': true,
} as const satisfies Record<IcmsStatus, true>;

/** reporting.yaml `IcmsStatus`, in the order the intake filters them. */
export const ICMS_STATUSES = Object.keys(ICMS_STATUS_SET) as [IcmsStatus, ...IcmsStatus[]];
