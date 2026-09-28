import type { Job } from '../db/schema.js';
import type { JobReason, JobStatus } from './job-states.js';

/** Contract `Job`. `output` is the validated output, present only once the job succeeded. */
export interface JobView {
  id: string;
  task: string;
  tenant: string;
  subjectRef: string;
  status: JobStatus;
  reason: JobReason | null;
  promptVersion: number;
  provider: string | null;
  model: string | null;
  inputHash: string;
  outputHash: string | null;
  usage: { tokensIn: number; tokensOut: number; costMicros: number; latencyMs: number };
  output: unknown;
  createdAt: string;
  finishedAt: string | null;
}

export function toJobView(row: Job): JobView {
  return {
    id: row.id,
    task: row.task,
    tenant: row.tenant,
    subjectRef: row.subjectRef,
    status: row.status,
    reason: row.reason,
    promptVersion: row.promptVersion,
    provider: row.provider,
    model: row.model,
    inputHash: row.inputHash,
    outputHash: row.outputHash,
    usage: {
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      costMicros: row.costMicros,
      latencyMs: row.latencyMs,
    },
    output: row.output ?? null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
