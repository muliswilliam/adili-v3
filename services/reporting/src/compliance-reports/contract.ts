/**
 * What passes between `ComplianceReportWorkflow`, its activities and the service that starts it.
 * Bundled into the workflow sandbox: types and constants only.
 *
 * Officers' names, designations and file numbers never pass through the workflow: they would sit
 * in Temporal's history, a second store. `aggregate` hands on obligation and clarification ids
 * and counts; `compileDraft` pulls the details by id, assembles the document and saves it
 * encrypted in one activity, and answers with the report id and counts. Reminders, the submitted
 * report's documents and its notices likewise pass the report id and read the rest themselves.
 */
import type { ReportCounts } from './schema.js';

/** Workflow type name, for starting by name (the worker bundles the code, not the caller). */
export const COMPLIANCE_REPORT_WORKFLOW = 'complianceReport';

/** One workflow per Commission and financial year. */
export function complianceReportWorkflowId(tenant: string, fy: number): string {
  return `compliance-report:${tenant}:${String(fy)}`;
}

/** Compile again from the projections as they are now (a supervisor's recompile). */
export const RECOMPILE_SIGNAL = 'recompile';

/**
 * The report was submitted: its draft is frozen, its Form M PDF and receipt are issued, the
 * officers are told, and the workflow ends.
 */
export const SUBMITTED_SIGNAL = 'submitted';

/** Deadline reminders while the report is not submitted: days before 31 July (Regs r.25(2)). */
export const REMINDER_DAYS = [14, 7, 1] as const;

/** When the reminder `daysBefore` the year's due date goes out: 09:00 in Nairobi (06:00 UTC). */
export function reminderAt(fy: number, daysBefore: number): number {
  return Date.UTC(fy + 1, 6, 31 - daysBefore, 6);
}

export interface ReportWorkflowInput {
  tenant: string;
  /** Financial year start year. */
  fy: number;
}

/**
 * The projections as at compile time: Form M's counts, the obligations of the officers who did
 * not declare on time per section, and the clarifications sought in the year. Ids only.
 */
export interface Aggregate {
  counts: ReportCounts;
  nonFilers: { initial: string[]; biennial: string[]; final: string[] };
  clarificationIds: string[];
}

export interface CompileRequest extends ReportWorkflowInput {
  aggregate: Aggregate;
}

/**
 * What `compileDraft` did: `saved` the draft (`first` when the report had none before), or
 * found the report `submitted` and left it frozen.
 */
export type CompileOutcome =
  | {
      outcome: 'saved';
      reportId: string;
      first: boolean;
      /** Schema problems left in the draft (e.g. Part I contacts not entered yet). */
      issues: number;
    }
  | { outcome: 'submitted'; reportId: string };

export interface NotifyRequest extends ReportWorkflowInput {
  reportId: string;
}

export interface ReminderRequest extends ReportWorkflowInput {
  daysBefore: number;
}

/**
 * What `remind` did: emailed the Commission's officers (`recipients`, none again for a reminder
 * already sent), or found the report submitted and sent nothing.
 */
export type ReminderOutcome = { outcome: 'sent'; recipients: number } | { outcome: 'submitted' };

/** The documents `issueSubmissionDocuments` issued for the submitted report, by id. */
export interface SubmissionDocuments {
  reportId: string;
  formMDocumentId: string;
  receiptDocumentId: string;
}

/** How the workflow ended: how many times it compiled and how many reminders went out. */
export interface ReportWorkflowResult {
  compiles: number;
  reminders: number;
}

/** Workflow type name of the yearly compile the service's Temporal schedule starts on 1 July. */
export const ANNUAL_COMPILE_WORKFLOW = 'annualCompile';

/** The schedule of the yearly compile, one per task queue. */
export function annualCompileScheduleId(taskQueue: string): string {
  return `compliance-report-annual-compile:${taskQueue}`;
}

/** The Commissions whose report for the year that just ended the yearly compile starts. */
export interface AnnualCompilePlan {
  fy: number;
  tenants: string[];
}
