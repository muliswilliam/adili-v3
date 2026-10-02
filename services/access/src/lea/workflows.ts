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
  LEA_REQUEST_CHECK_INTERVAL,
  LEA_REQUEST_SIGNALS,
  type LeaRequestResult,
  type LeaRequestSignal,
  type LeaRequestState,
  type LeaRequestWorkflowInput,
  leaReminderDueAt,
} from './contract.js';

const {
  leaRequestState,
  remindLeaOfficers,
  leaWithdrawnNotice,
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
  /** The declarant onboarded, or was told in writing: telling them of the grant runs again. */
  declarant: boolean;
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
 * its reasons behind sign-in; the declarant never hears of it. The filing officer may withdraw
 * it before the decision: the run tells the access officers and ends.
 *
 * The wait for the decision recovers from a lost signal by reading the request every
 * `LEA_REQUEST_CHECK_INTERVAL`. A reminder or breach flag that fails after its retries is logged
 * and the run goes on; a step after the decision that finally fails fails the run, with the
 * request as it is, for an operator to reset it in Temporal.
 */
export async function leaRequest(input: LeaRequestWorkflowInput): Promise<LeaRequestResult> {
  const state: RunState = { stop: null, declarant: false };
  const on: Record<LeaRequestSignal, () => void> = {
    decided: () => {
      state.stop ??= 'decided';
    },
    withdrawn: () => {
      state.stop ??= 'withdrawn';
    },
    onboarded: () => {
      state.declarant = true;
    },
    notified: () => {
      state.declarant = true;
    },
  };
  for (const name of LEA_REQUEST_SIGNALS) setHandler(defineSignal(name), on[name]);

  try {
    const received = await untilRecorded(input);
    if (received !== 'undecided') state.stop ??= received;
    const [stop] = await Promise.all([untilDecided(input, state), clock(input, state)]);
    if (stop === 'withdrawn') {
      // The access officers are told; one that cannot be is logged, and the run still ends.
      await passOver(input, leaWithdrawnNotice);
      return { outcome: stop };
    }
    if (stop !== 'decided') return { outcome: stop };
    return { outcome: await afterDecision(input, state) };
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
 * The decision clock while the request is undecided (fourteen days by default): the reminder four
 * days before the deadline (passed over when the deadline is due already), then the breach flag
 * at the deadline. Either failing after
 * its retries is logged and passed over.
 */
async function clock(input: LeaRequestWorkflowInput, state: RunState): Promise<void> {
  const decided = () => state.stop !== null;
  const deadline = new Date(input.deadlineAt).getTime();
  const reminder = leaReminderDueAt(input).getTime();

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
    log.warn('A step of the law enforcement request workflow failed', {
      requestId: input.requestId,
      activity: error.activityType,
    });
    return 'failed';
  }
}

/**
 * The decision is final: the agency's officer is told. A grant is told to the declarant, then
 * its package issued, announced to the officer, and expired at the end of its download window.
 * A declarant with no account is told once they onboard or the access officer records the
 * written notice, alongside the package.
 */
async function afterDecision(input: LeaRequestWorkflowInput, state: RunState): Promise<Stop> {
  const decided = await leaDecisionNotice(input);
  if (decided === 'missing') return 'missing';
  if (decided === 'denied') return 'decided';

  const told = await notifyDeclarantOfLeaGrant(input);
  if (told === 'missing') return 'missing';
  const [stop] = await Promise.all([
    packageCourse(input),
    told === 'awaiting-notice' ? untilDeclarantTold(input, state) : Promise.resolve(),
  ]);
  return stop;
}

/**
 * Waits for the declarant with no account to onboard (`onboarded`, or the directory read at each
 * check) or to be told in writing (`notified`), telling them online in the first case. A step
 * that fails after its retries is tried again at the next check.
 */
async function untilDeclarantTold(input: LeaRequestWorkflowInput, state: RunState): Promise<void> {
  for (;;) {
    await condition(() => state.declarant, LEA_REQUEST_CHECK_INTERVAL);
    state.declarant = false;
    try {
      if ((await notifyDeclarantOfLeaGrant(input)) !== 'awaiting-notice') return;
    } catch (error) {
      if (!(error instanceof ActivityFailure)) throw error;
      log.warn('Could not tell the declarant of the grant; trying again later', {
        requestId: input.requestId,
      });
    }
  }
}

/** The grant's package: issued, announced to the officer, expired at the end of its window. */
async function packageCourse(input: LeaRequestWorkflowInput): Promise<Stop> {
  const issued = await issueLeaPackage(input);
  // Nothing to disclose: the decision stands, with no package to issue.
  if (issued.outcome !== 'issued') return issued.outcome === 'missing' ? 'missing' : 'decided';
  await leaPackageReady(input);

  const open = new Date(issued.downloadExpiresAt).getTime() - Date.now();
  if (open > 0) await sleep(open);
  return (await expireLeaPackage(input)) === 'missing' ? 'missing' : 'decided';
}
