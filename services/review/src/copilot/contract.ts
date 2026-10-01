/**
 * What passes between the copilot's workflows, their activities and the consumer that starts
 * them. Bundled into the workflow sandbox: types and constants only. Identifiers only: the
 * copilot's inputs and outputs hold declaration content and never enter workflow history.
 */

/** Why the copilot of a case is requested. */
export type CopilotTrigger = 'case-created' | 'amendment' | 're-check' | 'refresh';

/** A request of the copilot by the service itself (the processing workflow, spec 07b's re-check). */
export interface CopilotActivityRequest {
  tenant: string;
  caseId: string;
  trigger: CopilotTrigger;
  /**
   * When the registries were checked (spec 07b); omitted keeps the record's. Until registry
   * matching lands the processing workflow omits it.
   */
  registryCheckedAt?: string | null;
}

/** A job of a case's copilot that has ended, from its `ai.job.*` event. */
export interface CopilotJobFinished {
  tenant: string;
  caseId: string;
  jobId: string;
}

/** Workflow type name of `copilotJobFinished`, for starting by name. */
export const COPILOT_JOB_FINISHED_WORKFLOW = 'copilotJobFinished';

/** One workflow per job, ever (a failed run may be started again). */
export function copilotJobWorkflowId(jobId: string): string {
  return `copilot-job:${jobId}`;
}
