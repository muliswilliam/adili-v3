/**
 * `LeaRequestWorkflow` (ADR-003), hosted by the access worker. Bundled into Temporal's
 * deterministic sandbox: import only `@temporalio/workflow` and types (and constants modules that
 * import nothing else).
 */
import {
  ActivityFailure,
  condition,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';

import { ACTIVITY_RETRY } from '../activity-retry.js';
import type { LeaRequestActivities } from './activities.js';
import {
  dayAfterLeaReceipt,
  LEA_REMINDER_DAY,
  LEA_REQUEST_CHECK_INTERVAL,
  LEA_REQUEST_SIGNALS,
  type LeaRequestResult,
  type LeaRequestSignal,
  type LeaRequestState,
  type LeaRequestWorkflowInput,
} from './contract.js';

const {
  leaRequestState,
  remindLeaOfficers,
  flagLeaBreach,
  leaDecisionNotice,
  notifyDeclarantOfLeaGrant,
  leaPackageReady,
  expireLeaPackage,
} = proxyActivities<LeaRequestActivities>({
  // A transaction and a few messages.
  startToCloseTimeout: '1 minute',
  retry: ACTIVITY_RETRY,
});

const { issueLeaPackage } = proxyActivities<LeaRequestActivities>({
  // The disclosure from declarations (2 s per attempt), rendering and signing at documents
  // (30 s per attempt, ADR-013 §2), then a transaction.
  startToCloseTimeout: '3 minutes',
  retry: ACTIVITY_RETRY,
});

type Stop = LeaRequestResult['outcome'];

interface RunState {
  stop: Stop | null;
}

/**
 * `LeaRequestWorkflow(requestId)` (spec 10, Act s.36(2), Regs r.23), started at receipt with the
 * request as workflow id, inside the receiving transaction; it first waits for that transaction
 * to end (a rolled-back receipt ends it as `missing`). While the access officer verifies and
 * decides, the access officers are reminded at day ten, and at the fourteen-day deadline an
 * undecided request is flagged as breached. Once decided, the agency's officer is told; a grant
 * (full or partial) is then told to the declarant (only now, r.23(2)), its scoped disclosure is
 * issued as the officer's Confidential, watermarked package, the officer is told it is ready,
 * and it expires at the end of its download window. A denial is told to the officer only, with
 * its reasons behind sign-in; the declarant never hears of it.
 *
 * The wait for the decision recovers from a lost signal by reading the request every
 * `LEA_REQUEST_CHECK_INTERVAL`. A reminder or breach flag that fails after its retries is logged
 * and the run goes on; a step after the decision that finally fails fails the run, with the
 * request as it is, for an operator to reset it in Temporal.
 */
export async function leaRequest(input: LeaRequestWorkflowInput): Promise<LeaRequestResult> {
  const state: RunState = { stop: null };
  const on: Record<LeaRequestSignal, () => void> = {
    decided: () => {
      state.stop ??= 'decided';
    },
    withdrawn: () => {
      state.stop ??= 'withdrawn';
    },
  };
  for (const name of LEA_REQUEST_SIGNALS) setHandler(defineSignal(name), on[name]);

  try {
    const received = await untilRecorded(input);
    if (received !== 'undecided') state.stop ??= received;
    const [stop] = await Promise.all([untilDecided(input, state), clock(input, state)]);
    if (stop !== 'decided') return { outcome: stop };
    return { outcome: await afterDecision(input) };
  } catch (error) {
    if (error instanceof ActivityFailure) {
      log.error('LeaRequestWorkflow step failed after its retries', {
        requestId: input.requestId,
        activity: error.activityType,
      });
    }
    throw error;
  }
}

/**
 * The request as it stands once the receiving transaction has ended (`leaRequestState` retries
 * until it has); read again every `LEA_REQUEST_CHECK_INTERVAL` while the database cannot be
 * reached.
 */
async function untilRecorded(input: LeaRequestWorkflowInput): Promise<LeaRequestState> {
  for (;;) {
    const found = await check(input);
    if (found !== null) return found;
    await sleep(LEA_REQUEST_CHECK_INTERVAL);
  }
}

/** The request read now; null when that failed after its retries (logged). */
async function check(input: LeaRequestWorkflowInput): Promise<LeaRequestState | null> {
  try {
    return await leaRequestState(input);
  } catch (error) {
    if (!(error instanceof ActivityFailure)) throw error;
    log.warn('Could not read the law enforcement request; reading it again later', {
      requestId: input.requestId,
    });
    return null;
  }
}

/**
 * Waits for the decision, or a withdrawal. The signals save waiting; every
 * `LEA_REQUEST_CHECK_INTERVAL` without one the request itself is read, so a signal lost after
 * its transaction committed delays what follows the decision, never loses it.
 */
async function untilDecided(input: LeaRequestWorkflowInput, state: RunState): Promise<Stop> {
  for (;;) {
    await condition(() => state.stop !== null, LEA_REQUEST_CHECK_INTERVAL);
    if (state.stop !== null) return state.stop;
    const found = await check(input);
    if (found !== null && found !== 'undecided') {
      state.stop = found;
      return found;
    }
  }
}

/**
 * The fourteen-day clock while the request is undecided: the reminder at day ten (passed over
 * when the deadline is due already), then the breach flag at the deadline. Either failing after
 * its retries is logged and passed over.
 */
async function clock(input: LeaRequestWorkflowInput, state: RunState): Promise<void> {
  const decided = () => state.stop !== null;
  const deadline = new Date(input.deadlineAt).getTime();
  const reminder = dayAfterLeaReceipt(input.receivedAt, LEA_REMINDER_DAY).getTime();

  if (reminder < deadline) {
    if (reminder > Date.now()) await condition(decided, reminder - Date.now());
    if (decided()) return;
    if (deadline > Date.now() && (await passOver(input, remindLeaOfficers)) === 'missing') {
      state.stop ??= 'missing';
      return;
    }
  }
  if (deadline > Date.now()) await condition(decided, deadline - Date.now());
  if (decided()) return;
  if ((await passOver(input, flagLeaBreach)) === 'missing') state.stop ??= 'missing';
}

/** Runs a step of the clock; one that fails after its retries is logged and passed over. */
async function passOver<T>(
  input: LeaRequestWorkflowInput,
  step: (input: LeaRequestWorkflowInput) => Promise<T>,
): Promise<T | 'failed'> {
  try {
    return await step(input);
  } catch (error) {
    if (!(error instanceof ActivityFailure)) throw error;
    log.warn('A step of the law enforcement request clock failed', {
      requestId: input.requestId,
      activity: error.activityType,
    });
    return 'failed';
  }
}

/**
 * The decision is final: the agency's officer is told. A grant is told to the declarant, then
 * its package issued, announced to the officer, and expired at the end of its download window.
 */
async function afterDecision(input: LeaRequestWorkflowInput): Promise<Stop> {
  const decided = await leaDecisionNotice(input);
  if (decided === 'missing') return 'missing';
  if (decided === 'denied') return 'decided';

  if ((await notifyDeclarantOfLeaGrant(input)) === 'missing') return 'missing';
  const issued = await issueLeaPackage(input);
  // Nothing to disclose: the decision stands, with no package to issue.
  if (issued.outcome !== 'issued') return issued.outcome === 'missing' ? 'missing' : 'decided';
  await leaPackageReady(input);

  const open = new Date(issued.downloadExpiresAt).getTime() - Date.now();
  if (open > 0) await sleep(open);
  return (await expireLeaPackage(input)) === 'missing' ? 'missing' : 'decided';
}
