/**
 * The bulk closure workflows (spec 08, ADR-003), hosted by the review worker. Bundled into
 * Temporal's deterministic sandbox: import only `@temporalio/workflow`, `@temporalio/common` and
 * types.
 */
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common';
import { continueAsNew, executeChild, proxyActivities, sleep, uuid4 } from '@temporalio/workflow';

import type { ClosureActivities } from './activities.js';
import {
  type ClosureNoticesInput,
  type ClosureNoticesResult,
  type ClosureSweepCounts,
  type ClosureSweepInput,
  closureSweepWorkflowId,
} from './contract.js';

/** Database and notifications work: retried with backoff until it succeeds. */
const RETRY = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '5 minutes',
} as const;

const { closureSweepTargets, sweepClosureChunk, recordClosureSweep, closuresApproved } =
  proxyActivities<ClosureActivities>({ startToCloseTimeout: '2 minutes', retry: RETRY });

const { notifyClosures } = proxyActivities<ClosureActivities>({
  // Two messages for each of up to 100 closures.
  startToCloseTimeout: '10 minutes',
  retry: RETRY,
});

/** Cases one sweep activity proposes or samples, in one transaction. */
export const SWEEP_CHUNK = 500;

/** Chunks one run of a sweep takes before continuing as new, to keep its history short. */
const CHUNKS_PER_RUN = 200;

/** How long the notices wait for the approval chunk that started them to commit, in seconds. */
const COMMIT_WAIT_SECONDS = 60;

/**
 * The daily run of the closure sweep, started by the service's Temporal schedule: finds the
 * Commissions' cycles with cases eligible now and runs `BulkClosureSweep` for each in turn, as a
 * child workflow per Commission and cycle and day.
 */
export async function closureSweeps(): Promise<{ swept: number }> {
  const plan = await closureSweepTargets();
  let swept = 0;
  for (const target of plan.targets) {
    try {
      await executeChild(closureSweep, {
        workflowId: closureSweepWorkflowId(target, plan.runDate),
        args: [{ ...target, sampleRate: plan.sampleRate, sweepId: uuid4() }],
      });
      swept += 1;
    } catch (error) {
      // The day's sweep of this cycle already runs (a manual trigger, say): leave it.
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
  return { swept };
}

/**
 * `BulkClosureSweep(tenant, cycleYear)` (spec 08): every eligible case of the Commission's cycle,
 * a chunk at a time, is either proposed as `compliant-no-issues` by the system or, in the
 * deterministic sample, diverted to a reviewer; then the sweep is recorded with its counts and
 * `closure.sweep.completed.v1`. Ids, counts and the rate only in history.
 */
export async function closureSweep(input: ClosureSweepInput): Promise<ClosureSweepCounts> {
  let proposed = input.proposed ?? 0;
  let sampled = input.sampled ?? 0;
  for (let chunk = 0; chunk < CHUNKS_PER_RUN; chunk += 1) {
    const done = await sweepClosureChunk({
      tenant: input.tenant,
      cycleYear: input.cycleYear,
      sampleRate: input.sampleRate,
      limit: SWEEP_CHUNK,
    });
    proposed += done.proposed;
    sampled += done.sampled;
    if (done.proposed + done.sampled < SWEEP_CHUNK) {
      await recordClosureSweep({
        tenant: input.tenant,
        cycleYear: input.cycleYear,
        sampleRate: input.sampleRate,
        sweepId: input.sweepId,
        proposed,
        sampled,
      });
      return { proposed, sampled };
    }
  }
  return continueAsNew<typeof closureSweep>({ ...input, proposed, sampled });
}

/**
 * The declarants of one committed chunk of a bulk approval told of their decisions, by person, by
 * email and SMS (the same messages and idempotency keys as an individual determination's). No
 * letter: a bulk closure's letter is issued when first asked for. Started inside the chunk's
 * transaction, so it first waits for that to commit; a chunk that rolled back ends the run.
 */
export async function closureNotices(input: ClosureNoticesInput): Promise<ClosureNoticesResult> {
  for (let waited = 0; !(await closuresApproved(input)); waited += 1) {
    if (waited >= COMMIT_WAIT_SECONDS) return { outcome: 'not-approved' };
    await sleep('1 second');
  }
  const count = await notifyClosures(input);
  return { outcome: 'notified', count };
}
