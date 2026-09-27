/** Contract enums of the job state machine: queued → running → succeeded | failed | blocked. */

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'blocked'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Statuses a job never leaves. */
export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  'succeeded',
  'failed',
  'blocked',
]);

/**
 * Why a job failed or was blocked:
 * - `validation`: the output did not match the task schema, or was cut off.
 * - `refused`: the model declined.
 * - `provider`: the provider call failed after retries, or cannot succeed.
 * - `timeout`: the provider kept timing out.
 * - `policy`, `budget`, `provider-unavailable`: set by the policy layer.
 */
export const JOB_REASONS = [
  'policy',
  'budget',
  'validation',
  'refused',
  'provider',
  'provider-unavailable',
  'timeout',
] as const;
export type JobReason = (typeof JOB_REASONS)[number];

export const DATA_CLASSES = ['synthetic', 'restricted', 'highly-confidential'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];
