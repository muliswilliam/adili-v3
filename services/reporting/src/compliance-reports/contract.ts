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

/**
 * `NationalConsolidationWorkflow(fy)` (spec 09): EACC's weekly chase of the Commissions that have
 * not submitted the year's report, from 1 August. What passes through it: the year, the weekly
 * round, Commission slugs and counts. Never a name or an email address.
 */
export const NATIONAL_CONSOLIDATION_WORKFLOW = 'nationalConsolidation';

/** One chase per financial year. */
export function nationalConsolidationWorkflowId(fy: number): string {
  return `national-consolidation:${String(fy)}`;
}

/** The national consolidated report was approved: the chase ends (BE-10 signals it). */
export const NCR_APPROVED_SIGNAL = 'ncr-approved';

/** A week, the interval between chases. */
export const CHASE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** The first chase of the year's non-reporting Commissions: 1 August, 09:00 in Nairobi. */
export function firstChaseAt(fy: number): number {
  return Date.UTC(fy + 1, 7, 1, 6);
}

/** The weekly round a chase at `at` belongs to: 1 in the week from 1 August, then 2, 3... */
export function chaseRoundAt(fy: number, at: number): number {
  return Math.max(0, Math.floor((at - firstChaseAt(fy)) / CHASE_INTERVAL_MS)) + 1;
}

export interface ChaseWorkflowInput {
  /** Financial year start year. */
  fy: number;
  /** Carried over when the chase continues in a fresh history: rounds and chases so far. */
  rounds?: number;
  chases?: number;
  /** When the next round is due (epoch ms); the first chase when absent. */
  nextAt?: number;
}

/**
 * The Commissions (slugs) without a submitted report for the year; `ncrApproved` when the year's
 * national consolidated report is approved already (the chase ends even if its signal was missed).
 */
export interface ChaseTargets {
  tenants: string[];
  ncrApproved?: boolean;
}

export interface ChaseRequest {
  fy: number;
  tenant: string;
  round: number;
}

/**
 * What `chaseCommission` did: emailed the Commission's reporting officers and commission-admins
 * (`recipients`; none again for a round chased already), or found the report submitted meanwhile.
 */
export type ChaseOutcome = { outcome: 'chased'; recipients: number } | { outcome: 'submitted' };

/** How the chase ended: every Commission reported, or the NCR was approved. */
export interface ChaseWorkflowResult {
  rounds: number;
  chases: number;
  ended: 'all-reported' | 'ncr-approved';
}

/** Workflow type name of the yearly start of the chase, which the service's schedule runs. */
export const NATIONAL_CHASE_START_WORKFLOW = 'nationalChaseStart';

/** The schedule of the yearly start of the chase, one per task queue. */
export function nationalChaseScheduleId(taskQueue: string): string {
  return `national-consolidation-chase:${taskQueue}`;
}
