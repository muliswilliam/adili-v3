import type { ReportSource, ReportStatus } from './schema.js';

/**
 * Events the reporting service publishes about compliance reports (spec 09, outbox,
 * CloudEvents). Identifiers, counts and statuses only: never the document or a name. The tenant
 * extension is the Commission's slug and the subject the report id.
 */
export const COMPLIANCE_REPORT_DRAFTED = 'compliance-report.drafted.v1';

/** `compliance-report.drafted.v1`: a draft was compiled (or recompiled). */
export interface ComplianceReportDraftedData extends Record<string, unknown> {
  reportId: string;
  fy: number;
  status: ReportStatus;
  source: ReportSource;
}
