/**
 * What passes between `ComplianceReportWorkflow`, its activities and the service that starts it.
 * Bundled into the workflow sandbox: types and constants only.
 *
 * Officers' names, designations and file numbers never pass through the workflow: they would sit
 * in Temporal's history, a second store. `aggregate` hands on obligation and clarification ids
 * and counts; `compileDraft` pulls the details by id, assembles the document and saves it
 * encrypted in one activity, and answers with the report id and counts.
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

/** The report was submitted: its draft is frozen and the workflow ends. */
export const SUBMITTED_SIGNAL = 'submitted';

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

/** How the workflow ended: how many times it compiled. */
export interface ReportWorkflowResult {
  compiles: number;
}
