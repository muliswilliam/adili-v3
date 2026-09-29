/**
 * `EnforcementWorkflow` (spec 08, refines ADR-003), hosted by the review worker. Bundled into
 * Temporal's deterministic sandbox: import only `@temporalio/workflow` and types.
 */
import { condition, defineSignal, proxyActivities, setHandler, sleep } from '@temporalio/workflow';

import type { EnforcementActivities } from './activities.js';
import {
  ACTION_CHANNELS,
  type ActionRef,
  CLOSED_SIGNAL,
  DECIDED_SIGNAL,
  type EnforcementInput,
  type EnforcementResult,
  isCompliance,
  LADDER_STEPS,
  type LadderRef,
} from './contract.js';
import type { ClosingCause } from './schema.js';

/**
 * Calls to documents, notifications, the directory, declarations and the database: retried with
 * backoff until they succeed, so an outage delays a letter or a message, never loses it.
 */
const RETRY = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '5 minutes',
} as const;

const {
  openLadder,
  proposeStep,
  actionDecision,
  issueLetter,
  notifyAction,
  markIssued,
  closeLadder,
} = proxyActivities<EnforcementActivities>({
  // Rendering and signing a letter takes seconds.
  startToCloseTimeout: '2 minutes',
  retry: RETRY,
});

export const decidedSignal = defineSignal(DECIDED_SIGNAL);
export const closedSignal = defineSignal<[ClosingCause]>(CLOSED_SIGNAL);

/**
 * How long the workflow waits, after a `decided` signal, for the transaction that sent it to
 * commit, in one-second steps. Past that the transaction rolled back and the step still waits.
 */
const COMMIT_WAIT_SECONDS = 60;

/**
 * How often a step waiting for a decision is looked at without a signal, so a decision whose
 * signal was lost is still acted on.
 */
const DECISION_RECHECK = '1 day';

/**
 * `EnforcementWorkflow(subjectKind, subjectId)` (spec 08): started when a filing obligation goes
 * overdue or a clarification goes unanswered, with the subject as workflow id, so a repeated event
 * starts nothing. For each step (notice to comply, then warning): draft it (`system`), wait for an
 * officer to approve or decline it; once approved, request its Restricted `ADM` letter, tell the
 * declarant by email and SMS, mark it issued and wait out its window. A decline ends the ladder (a
 * supervisor may restart it at that step). Compliance (the obligation filed, the clarification
 * answered or resolved) ends it at any point; so does the subject going away.
 */
export async function enforcement(input: EnforcementInput): Promise<EnforcementResult> {
  let closing: ClosingCause | null = null;
  let decisions = 0;
  setHandler(closedSignal, (cause) => {
    closing ??= cause;
  });
  setHandler(decidedSignal, () => {
    decisions += 1;
  });
  const closed = () => closing;

  const opened = await openLadder(input);
  if (opened.outcome !== 'opened') return { outcome: opened.outcome };
  const ladder: LadderRef = { tenant: input.tenant, ladderId: opened.ladderId };

  const first = input.restartAt === undefined ? 0 : LADDER_STEPS.indexOf(input.restartAt);
  for (const step of LADDER_STEPS.slice(first)) {
    const early = closed();
    if (early !== null) return close(ladder, early);
    // Counted before the draft: a decision may come as soon as the draft commits.
    const seen = decisions;
    const { actionId } = await proposeStep({ ...ladder, step });
    const action: ActionRef = { tenant: input.tenant, actionId };

    const decision = await decided(action, closed, () => decisions, seen);
    if (decision === 'declined') return { outcome: 'declined', step };
    if (decision === 'closed') {
      const cause = closed();
      // Closed without a signal of this run: another run closed the ladder.
      return cause === null ? { outcome: 'closed' } : close(ladder, cause);
    }

    await issueLetter(action);
    for (const channel of ACTION_CHANNELS) {
      await notifyAction({ ...action, channel });
    }
    const { windowEndsAt } = await markIssued(action);
    const cause = await closedBefore(new Date(windowEndsAt), closed);
    if (cause !== null) return close(ladder, cause);
  }
  // #209 drafts the salary stoppage here. Until then, the ladder waits for compliance.
  await condition(() => closed() !== null);
  const cause = closed();
  return cause === null ? { outcome: 'closed' } : close(ladder, cause);
}

/** Records the closing of the ladder: open steps complied or cancelled. */
async function close(ladder: LadderRef, cause: ClosingCause): Promise<EnforcementResult> {
  await closeLadder({ ...ladder, cause });
  return { outcome: isCompliance(cause) ? 'complied' : 'ended', cause };
}

/**
 * Waits until the step is approved or declined, or the ladder closes. A `decided` signal makes the
 * workflow read the step at once (then each second while the transaction that sent it commits);
 * without one it reads the step once a day.
 */
async function decided(
  action: ActionRef,
  closed: () => ClosingCause | null,
  decisions: () => number,
  before: number,
): Promise<'approved' | 'declined' | 'closed'> {
  let seen = before;
  for (;;) {
    await condition(() => closed() !== null || decisions() !== seen, DECISION_RECHECK);
    if (closed() !== null) return 'closed';
    const signalled = decisions() !== seen;
    seen = decisions();
    for (let waited = 0; ; waited += 1) {
      const state = await actionDecision(action);
      if (state !== 'proposed') return state;
      if (!signalled || waited >= COMMIT_WAIT_SECONDS || closed() !== null) break;
      await sleep('1 second');
    }
  }
}

/** Waits until `at` (workflow time) or the ladder closing, whichever comes first; the cause. */
async function closedBefore(
  at: Date,
  closed: () => ClosingCause | null,
): Promise<ClosingCause | null> {
  const wait = at.getTime() - Date.now();
  if (wait > 0) await condition(() => closed() !== null, wait);
  return closed();
}
