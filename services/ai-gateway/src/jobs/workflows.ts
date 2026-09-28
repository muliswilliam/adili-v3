import {
  ActivityFailure,
  ApplicationFailure,
  proxyActivities,
  TimeoutFailure,
} from '@temporalio/workflow';

import { PROVIDER_TIMEOUT_ERROR } from './failures.js';
import type { JobActivities } from './job-activities.js';
import type { JobReason } from './job-states.js';

/** Workflow code: bundled into Temporal's deterministic sandbox, so it imports types only. */

export interface AiJobInput {
  jobId: string;
  /** Longest a single execution attempt may take; above the provider timeout. */
  attemptTimeoutMs: number;
}

/** Retry schedule for transient provider errors: 2 s, 4 s, 8 s, then the job fails. */
export const EXECUTE_RETRY = {
  initialInterval: '2 seconds',
  backoffCoefficient: 2,
  maximumInterval: '30 seconds',
  maximumAttempts: 4,
} as const;

/**
 * Runs one job to a final state: executes it, retrying transient failures, and if every
 * attempt fails records the job as failed. The job never stays queued or running.
 */
export async function aiJob(input: AiJobInput): Promise<void> {
  const { executeJob } = proxyActivities<JobActivities>({
    startToCloseTimeout: input.attemptTimeoutMs,
    retry: EXECUTE_RETRY,
  });
  // Recording the failure only touches the database: retry it until it lands.
  const { failJob } = proxyActivities<JobActivities>({
    startToCloseTimeout: '30 seconds',
    retry: { initialInterval: '1 second', maximumInterval: '1 minute' },
  });
  try {
    await executeJob(input.jobId);
  } catch (error) {
    if (!(error instanceof ActivityFailure)) throw error;
    await failJob(input.jobId, failureReason(error));
  }
}

function failureReason(failure: ActivityFailure): JobReason {
  const cause = failure.cause;
  if (cause instanceof ApplicationFailure && cause.type === PROVIDER_TIMEOUT_ERROR) {
    return 'timeout';
  }
  // Timed-out attempts (the activity's own start-to-close) count as provider timeouts too.
  if (cause instanceof TimeoutFailure) return 'timeout';
  return 'provider';
}
