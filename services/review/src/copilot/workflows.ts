/**
 * The copilot's workflow steps (spec 07c). Bundled into Temporal's deterministic sandbox through
 * the processing workflows module: import only `@temporalio/workflow` and types.
 */
import { ActivityFailure, proxyActivities } from '@temporalio/workflow';

import type { CopilotActivities } from './activities.js';
import type { CopilotActivityRequest, CopilotJobFinished } from './contract.js';

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
const { copilotUnavailable } = proxyActivities<CopilotActivities>({
  startToCloseTimeout: '1 minute',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '5 minutes' },
});

/**
 * `requestCopilot(caseId)` as a step of a workflow (`DeclarationProcessingWorkflow`, spec 07b's
 * re-check): the record is `pending` (or `stale`) with the jobs, or `failed` when the gateway
 * could not be reached.
 */
export async function requestCaseCopilot(request: CopilotActivityRequest): Promise<void> {
  try {
    await requestCopilot(request);
  } catch (error) {
    if (!(error instanceof ActivityFailure)) throw error;
    await copilotUnavailable({ tenant: request.tenant, caseId: request.caseId });
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
