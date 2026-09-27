import type { NewEvent } from '@adili/events';

import type { jobs } from '../db/schema.js';
import type { JobReason } from './job-states.js';

/**
 * Events announcing a finished job (spec 07c). Hashes and counts only: never the input, the
 * output or any other content (ADR-013 §3). The caller pulls the output by job id.
 * Documented here until the AsyncAPI file lands.
 */

export const AI_JOB_COMPLETED = 'ai.job.completed.v1';
export const AI_JOB_FAILED = 'ai.job.failed.v1';

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

/** `ai.job.completed.v1` or `ai.job.failed.v1` for a job that has just ended. */
export function jobFinished(job: typeof jobs.$inferSelect): NewEvent<AiJobFinishedData> {
  return {
    type: job.status === 'succeeded' ? AI_JOB_COMPLETED : AI_JOB_FAILED,
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
