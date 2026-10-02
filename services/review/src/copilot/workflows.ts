/**
 * The copilot's workflow steps (spec 07c). Bundled into Temporal's deterministic sandbox through
 * the processing workflows module: import only `@temporalio/workflow` and types.
 */
import {
  ActivityFailure,
  ApplicationFailure,
  continueAsNew,
  proxyActivities,
} from '@temporalio/workflow';

import type { CopilotActivities } from './activities.js';
import {
  COPILOT_UNAVAILABLE,
  type CopilotActivityRequest,
  type CopilotJobFinished,
  type CopilotPolicyChanged,
  type CopilotUnavailableReason,
} from './contract.js';

/**
 * Calls of the ai-gateway (and the pulls before them): retried with backoff for some minutes. The
 * copilot is an aid, never a step a case waits for, so the workflow then records it as failed
 * (the assignee can try again) instead of retrying for good.
 */
const { requestCopilot, recordCopilotJob } = proxyActivities<CopilotActivities>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '1 minute',
    maximumAttempts: 10,
  },
});

/** Database work only: retried until it succeeds. */
const { copilotUnavailable, notEnabledCopilots } = proxyActivities<CopilotActivities>({
  startToCloseTimeout: '1 minute',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '5 minutes' },
});

/**
 * `requestCopilot(caseId)` as a step of a workflow (`DeclarationProcessingWorkflow`, spec 07b's
 * re-check): the record is `pending` (or `stale`) with the jobs, or `failed` when the declaration
 * could not be pulled (`declarations-unavailable`) or the gateway reached
 * (`ai-gateway-unavailable`).
 */
export async function requestCaseCopilot(request: CopilotActivityRequest): Promise<void> {
  try {
    await requestCopilot(request);
  } catch (error) {
    if (!(error instanceof ActivityFailure)) throw error;
    await copilotUnavailable({
      tenant: request.tenant,
      caseId: request.caseId,
      reason: unavailableOf(error),
    });
  }
}

/** Which service stayed unreachable: the declaration's pull, or (by default) the ai-gateway. */
function unavailableOf(error: ActivityFailure): CopilotUnavailableReason {
  return error.cause instanceof ApplicationFailure && error.cause.type === 'DeclarationsUnavailable'
    ? COPILOT_UNAVAILABLE.declarations
    : COPILOT_UNAVAILABLE.aiGateway;
}

/** Not-enabled copilots one page of `copilotPolicyChanged` requests again. */
export const COPILOT_POLICY_PAGE = 100;

/** Pages one run of `copilotPolicyChanged` takes before continuing as new, to keep history short. */
export const COPILOT_POLICY_PAGES_PER_RUN = 5;

/**
 * Started by the `ai.policy.changed.v1` consumer when a gate rule of the Commission now admits a
 * provider class: each of its cases whose copilot was not enabled is requested again, one after
 * another, and the gateway decides anew. A case still blocked reads `not-enabled` again. The
 * cases are read a page at a time in case id order (`after`), and the run continues as new every
 * few pages, so a Commission of any size fits in workflow history.
 */
export async function copilotPolicyChanged(input: CopilotPolicyChanged): Promise<void> {
  const { tenant } = input;
  let after = input.after ?? null;
  for (let pages = 0; ; pages += 1) {
    if (pages >= COPILOT_POLICY_PAGES_PER_RUN) {
      return continueAsNew<typeof copilotPolicyChanged>({ tenant, after });
    }
    const page = await notEnabledCopilots({ tenant, after, limit: COPILOT_POLICY_PAGE });
    for (const caseId of page.caseIds) {
      await requestCaseCopilot({ tenant, caseId, trigger: 'policy-change' });
    }
    after = page.next;
    if (after === null) return;
  }
}

/**
 * Started by the `ai.job.*` consumer, one per ended job of a case's copilot: pulls the job's
 * outcome and records it (the output stored encrypted). Retried with backoff, so an outage of the
 * gateway or the key service delays the panel, never loses its outputs.
 */
export async function copilotJobFinished(job: CopilotJobFinished): Promise<void> {
  try {
    await recordCopilotJob(job);
  } catch (error) {
    if (!(error instanceof ActivityFailure)) throw error;
    await copilotUnavailable(job);
  }
}
