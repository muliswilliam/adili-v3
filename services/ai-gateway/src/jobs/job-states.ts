import { z } from 'zod';

/** Contract enums of the job state machine: queued → running → succeeded | failed | blocked. */

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'blocked'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const jobStatusSchema = z.enum(JOB_STATUSES);

/** Statuses of a job still to finish. */
export const LIVE_STATUSES = ['queued', 'running'] as const;

/** Statuses of a job that answers an equal request (the cache): live, or succeeded. */
export const CACHEABLE_STATUSES = [...LIVE_STATUSES, 'succeeded'] as const;

/** Statuses a job never leaves. */
export type TerminalStatus = Exclude<JobStatus, (typeof LIVE_STATUSES)[number]>;

export function isTerminal(status: JobStatus): status is TerminalStatus {
  return !(LIVE_STATUSES as readonly JobStatus[]).includes(status);
}

/**
 * Why a job failed or was blocked:
 * - `validation`: the output did not match the task schema, or was cut off.
 * - `refused`: the model declined.
 * - `provider`: the provider call failed after retries, or cannot succeed; also any other
 *   failure that ends a job without a result (the contract has no internal reason yet).
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
export const jobReasonSchema = z
  .enum(JOB_REASONS)
  .meta({ description: 'Set when failed or blocked' });
