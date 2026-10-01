/**
 * Events the review service publishes about bulk closure (spec 08, outbox, CloudEvents). Counts
 * and identifiers only. The tenant extension is the Commission's slug and the subject the sweep id.
 */
export const CLOSURE_SWEEP_COMPLETED = 'closure.sweep.completed.v1';

/** `closure.sweep.completed.v1`: what one run of the sweep did for a Commission's cycle. */
export interface ClosureSweepCompletedData extends Record<string, unknown> {
  sweepId: string;
  cycleYear: number;
  proposed: number;
  sampled: number;
  sampleRate: number;
}
