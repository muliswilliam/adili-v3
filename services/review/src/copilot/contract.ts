/**
 * What passes between the copilot's workflows, their activities and the consumer that starts
 * them. Bundled into the workflow sandbox: types and constants only. Identifiers only: the
 * copilot's inputs and outputs hold declaration content and never enter workflow history.
 */

/** Why the copilot of a case is requested. */
export type CopilotTrigger =
  'case-created' | 'amendment' | 're-check' | 'refresh' | 'policy-change';

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

/**
 * Why the copilot of a case could not be requested or its job recorded, once the workflow stopped
 * retrying: which service stayed unreachable, or (`internal-error`) an error of the review
 * service's own.
 */
export const COPILOT_UNAVAILABLE = {
  declarations: 'declarations-unavailable',
  aiGateway: 'ai-gateway-unavailable',
  keyService: 'key-service-unavailable',
  internal: 'internal-error',
} as const;
export type CopilotUnavailableReason =
  (typeof COPILOT_UNAVAILABLE)[keyof typeof COPILOT_UNAVAILABLE];

/** The reason of a failure by the name of the error the activity threw. */
export const COPILOT_UNAVAILABLE_BY_ERROR: Readonly<Record<string, CopilotUnavailableReason>> = {
  DeclarationsUnavailable: COPILOT_UNAVAILABLE.declarations,
  AiGatewayUnavailable: COPILOT_UNAVAILABLE.aiGateway,
  FieldCipherError: COPILOT_UNAVAILABLE.keyService,
};

/** A job of a case's copilot that has ended, from its `ai.job.*` event. */
export interface CopilotJobFinished {
  tenant: string;
  caseId: string;
  jobId: string;
}

/** A gate policy of the Commission now admits a provider class: its not-enabled copilots ask again. */
export interface CopilotPolicyChanged {
  tenant: string;
  /** The last case of the previous run's pages (a continuation); null or omitted starts over. */
  after?: string | null;
}

/** A page of a Commission's not-enabled copilots, in case id order. */
export interface NotEnabledPage {
  caseIds: string[];
  /** The cursor of the next page; null when this is the last. */
  next: string | null;
}

/** Workflow type name of `copilotPolicyChanged`, for starting by name. */
export const COPILOT_POLICY_CHANGED_WORKFLOW = 'copilotPolicyChanged';

/** One workflow per `ai.policy.changed.v1` event. */
export function copilotPolicyWorkflowId(eventId: string): string {
  return `copilot-policy:${eventId}`;
}

/** Workflow type name of `copilotJobFinished`, for starting by name. */
export const COPILOT_JOB_FINISHED_WORKFLOW = 'copilotJobFinished';

/** One workflow per job, ever (a failed run may be started again). */
export function copilotJobWorkflowId(jobId: string): string {
  return `copilot-job:${jobId}`;
}
