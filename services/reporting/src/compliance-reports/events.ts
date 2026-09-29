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

export const COMPLIANCE_REPORT_REVIEWED = 'compliance-report.reviewed.v1';

/** `compliance-report.reviewed.v1`: a supervisor marked the draft reviewed. */
export interface ComplianceReportReviewedData extends Record<string, unknown> {
  reportId: string;
  fy: number;
  status: ReportStatus;
  source: ReportSource;
}

export const COMPLIANCE_REPORT_SUBMITTED = 'compliance-report.submitted.v1';

/** `compliance-report.submitted.v1`: the report was confirmed and submitted to EACC. */
export interface ComplianceReportSubmittedData extends Record<string, unknown> {
  reportId: string;
  fy: number;
  status: ReportStatus;
  reference: string;
  late: boolean;
  source: ReportSource;
}

export const COMPLIANCE_REPORT_REMINDER_SENT = 'compliance-report.reminder-sent.v1';

/** `compliance-report.reminder-sent.v1`: the officers were reminded of the 31 July deadline. */
export interface ComplianceReportReminderSentData extends Record<string, unknown> {
  reportId: string;
  fy: number;
  daysBefore: number;
  recipients: number;
}
