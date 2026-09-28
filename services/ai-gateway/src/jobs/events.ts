import type { NewEvent } from '@adili/events';

import type { Job } from '../db/schema.js';
import { isTerminal, type JobReason, type TerminalStatus } from './job-states.js';

/**
 * Events announcing a finished job (spec 07c). Hashes and counts only: never the input, the
 * output or any other content (ADR-013 §3). The caller pulls the output by job id.
 * Documented here until the AsyncAPI file lands.
 */

export const AI_JOB_COMPLETED = 'ai.job.completed.v1';
export const AI_JOB_FAILED = 'ai.job.failed.v1';
export const AI_JOB_BLOCKED = 'ai.job.blocked.v1';

const FINISHED_EVENTS: Record<TerminalStatus, string> = {
  succeeded: AI_JOB_COMPLETED,
  failed: AI_JOB_FAILED,
  blocked: AI_JOB_BLOCKED,
};

export interface AiJobFinishedData extends Record<string, unknown> {
  jobId: string;
  task: string;
  tenant: string;
  subjectRef: string;
  promptVersion: number;
  provider: string;
  model: string;
  inputHash: string;
  /** Null unless the job succeeded. */
  outputHash: string | null;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
  latencyMs: number;
  /** Null when the job succeeded. */
  reason: JobReason | null;
}

/** `ai.job.completed.v1`, `failed.v1` or `blocked.v1` for a job that has just ended. */
export function jobFinished(job: Job): NewEvent<AiJobFinishedData> {
  if (!isTerminal(job.status)) {
    throw new Error(`Job ${job.id} has not finished`);
  }
  return {
    type: FINISHED_EVENTS[job.status],
    subject: job.id,
    tenant: job.tenant,
    data: {
      jobId: job.id,
      task: job.task,
      tenant: job.tenant,
      subjectRef: job.subjectRef,
      promptVersion: job.promptVersion,
      provider: job.provider,
      model: job.model,
      inputHash: job.inputHash,
      outputHash: job.outputHash,
      tokensIn: job.tokensIn,
      tokensOut: job.tokensOut,
      costMicros: job.costMicros,
      latencyMs: job.latencyMs,
      reason: job.reason,
    },
  };
}
