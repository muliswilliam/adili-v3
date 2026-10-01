/**
 * What passes between `NationalReportApprovalWorkflow`, its activities and the service that
 * starts it. Bundled into the workflow sandbox: types and constants only. The report id and the
 * year only: the narrative, the figures and the approver's name are read by the activity that
 * renders the PDF, never carried in Temporal history.
 */

/** The issuer segment of `NCR` references (ADR-011): EACC issues the national report. */
export const NCR_ISSUER = 'EACC';

/** Workflow type name, for starting by name (the worker bundles the code, not the caller). */
export const NATIONAL_REPORT_APPROVAL_WORKFLOW = 'nationalReportApproval';

/** One approval workflow per national consolidated report. */
export function nationalReportApprovalWorkflowId(nationalReportId: string): string {
  return `national-report-approval:${nationalReportId}`;
}

export interface NationalReportApprovalInput {
  nationalReportId: string;
  /** Financial year start year. */
  fy: number;
}

/** The issued NCR PDF, by id. */
export interface NationalReportDocument {
  documentId: string;
}

/** How the approval ended: the PDF issued and whether a running chase was told to end. */
export interface NationalReportApprovalResult {
  documentId: string;
  chaseEnded: boolean;
}
