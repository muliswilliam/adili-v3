/**
 * What passes between the bulk closure workflows, their activities and the code that starts them.
 * Bundled into the workflow sandbox: types and constants only.
 *
 * Identifiers, counts and rates only: no names, references or outcomes enter Temporal's history.
 */

/** Workflow type names, for starting by name (the worker bundles the code, not the caller). */
export const CLOSURE_SWEEPS_WORKFLOW = 'closureSweeps';
export const CLOSURE_SWEEP_WORKFLOW = 'closureSweep';
export const CLOSURE_NOTICES_WORKFLOW = 'closureNotices';

/** The Temporal schedule that starts `closureSweeps` daily, one per task queue. */
export function closureSweepScheduleId(taskQueue: string): string {
  return `closure-sweep-schedule:${taskQueue}`;
}

/** A Commission's cycle whose window has passed with cases eligible for bulk closure. */
export interface ClosureSweepTarget {
  tenant: string;
  cycleYear: number;
}

/** `BulkClosureSweep(tenant, cycleYear)` (spec 08), one child run per target per day. */
export function closureSweepWorkflowId(target: ClosureSweepTarget, runDate: string): string {
  return `closure-sweep:${target.tenant}:${String(target.cycleYear)}:${runDate}`;
}

/** What `closureSweepTargets` answers: the targets, the sample rate and the run's date. */
export interface ClosureSweepPlan {
  targets: ClosureSweepTarget[];
  /** Fraction diverted to review, from the service's configuration. */
  sampleRate: number;
  /** Nairobi date of the run, `YYYY-MM-DD`: part of the child workflow ids. */
  runDate: string;
}

export interface ClosureSweepInput extends ClosureSweepTarget {
  sampleRate: number;
  /** Chosen once by the workflow: the sweep's record id. */
  sweepId: string;
  /** Counts carried across continue-as-new. */
  proposed?: number;
  sampled?: number;
}

/** One chunk of the sweep: at most `limit` eligible cases, proposed or sampled. */
export interface ClosureSweepChunk extends ClosureSweepTarget {
  sampleRate: number;
  limit: number;
}

export interface ClosureSweepCounts {
  proposed: number;
  sampled: number;
}

export interface ClosureSweepRecord extends ClosureSweepTarget, ClosureSweepCounts {
  sampleRate: number;
  sweepId: string;
}

/** The approved closures of one chunk of a bulk approval, whose declarants are told. */
export interface ClosureNoticesInput {
  tenant: string;
  determinationIds: string[];
}

/** One workflow per committed chunk of a bulk approval. */
export function closureNoticesWorkflowId(chunkId: string): string {
  return `closure-notices:${chunkId}`;
}

export type ClosureNoticesResult =
  { outcome: 'notified'; count: number } | { outcome: 'not-approved' };
