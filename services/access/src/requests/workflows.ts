/**
 * `AccessRequestWorkflow` (ADR-003), hosted by the access worker. Bundled into Temporal's
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
import type { AccessRequestActivities } from './activities.js';
import {
  ACCESS_REQUEST_SIGNALS,
  type AccessRequestResult,
  type AccessRequestSignal,
  type AccessRequestWorkflowInput,
  OFFICER_REMINDER_DAYS,
  reminderDueAt,
  REQUEST_CHECK_INTERVAL,
  type RequestState,
} from './contract.js';
import type { DecisionActivities } from './decision-activities.js';

const { requestState, resolution, closeWindow, remindOfficer } =
  proxyActivities<AccessRequestActivities>({
    // A transaction and a few messages.
    startToCloseTimeout: '1 minute',
    retry: ACTIVITY_RETRY,
  });

const { decisionNotices, packageReady, packageFailed, expirePackage } =
  proxyActivities<DecisionActivities>({
    // A transaction and a few messages.
    startToCloseTimeout: '1 minute',
    retry: ACTIVITY_RETRY,
  });

const { issuePackage } = proxyActivities<DecisionActivities>({
  // The disclosure from declarations (2 s per attempt), rendering and signing at documents
  // (30 s per attempt, ADR-013 §2), then a transaction.
  startToCloseTimeout: '3 minutes',
  retry: ACTIVITY_RETRY,
});

/** What ends the run early: the applicant withdrew, the officer decided, or no request is there. */
type Stop = 'withdrawn' | 'decided' | 'missing';

/** What the signals (and the reads that make up for lost ones) told the run so far. */
interface RunState {
  verified: boolean;
  resolved: boolean;
  consented: boolean;
  stop: Stop | null;
  /** The request's own course has ended: the reminders stop too. */
  ended: boolean;
}

/**
 * `AccessRequestWorkflow(requestId)` (spec 10, Act s.36(3)), started at receipt with the request
 * as workflow id, inside the receiving transaction; it first waits for that transaction to end
 * (a rolled-back receipt ends it as `missing`). A passport applicant's request waits for the
 * access officer to verify them; then the run waits for the officer to resolve the officer Form
 * K names, notifies the declarant and holds the window for representations (seven days) unless
 * they consent earlier, after which the request is `under-decision` until the officer decides.
 * The decision is told to both parties; a grant's package is issued to the applicant, who is
 * told it is ready, and it expires at the end of its download window (fourteen days).
 * Alongside, from receipt, the access officers are reminded at day five while the officer is
 * unidentified (or the applicant unverified) and of the decision deadline (the Commission's
 * period at receipt, thirty days by default) ten and two days before it. A request the officer cannot identify closes, with the applicant told.
 * Withdrawal ends it at any point before the decision.
 *
 * Every wait recovers from a lost signal by reading the request every `REQUEST_CHECK_INTERVAL`.
 * A step that waits (the resolution's notices) and fails after its retries is tried again at the
 * next read; a missed reminder is logged and the run goes on; any other step that finally fails
 * (the decision's notices, the package) fails the run, with the request as it is, for an operator
 * to reset it in Temporal.
 */
export async function accessRequest(
  input: AccessRequestWorkflowInput,
): Promise<AccessRequestResult> {
  const state: RunState = {
    verified: false,
    resolved: false,
    consented: false,
    stop: null,
    ended: false,
  };
  const on: Record<AccessRequestSignal, () => void> = {
    verified: () => {
      state.verified = true;
    },
    resolved: () => {
      state.resolved = true;
    },
    // The declarant's account or notice changed: the resolution step runs again.
    onboarded: () => {
      state.resolved = true;
    },
    notified: () => {
      state.resolved = true;
    },
    consented: () => {
      state.consented = true;
    },
    withdrawn: () => {
      state.stop ??= 'withdrawn';
    },
    decided: () => {
      state.stop ??= 'decided';
    },
  };
  for (const name of ACCESS_REQUEST_SIGNALS) setHandler(defineSignal(name), on[name]);

  const received = await untilRecorded(input);
  const closed = stopOf(received);
  if (closed !== null) return carriedOut(input, { outcome: stopWith(state, closed) });
  try {
    const [result] = await Promise.all([course(input, state, received), reminders(input, state)]);
    return result;
  } catch (error) {
    if (error instanceof ActivityFailure) {
      log.error('AccessRequestWorkflow step failed after its retries', {
        requestId: input.requestId,
        activity: error.activityType,
      });
    }
    throw error;
  }
}

/**
 * Verification, resolution, the declarant's notice and window, then the decision and what
 * follows it.
 */
async function course(
  input: AccessRequestWorkflowInput,
  state: RunState,
  received: RequestState,
): Promise<AccessRequestResult> {
  try {
    if (received === 'held') {
      const stop = await untilVerified(input, state);
      if (stop !== null) return await carriedOut(input, { outcome: stop });
    }

    const notified = await untilNotified(input, state);
    if (typeof notified !== 'string') return await carriedOut(input, notified);

    await untilWindowEnds(input, state, new Date(notified).getTime());
    if (state.stop === 'withdrawn' || state.stop === 'missing') return { outcome: state.stop };
    // Decided already (the declarant consented and the consent's signal was lost): the window
    // is closed, and closing it changes nothing.
    if ((await closeWindow(input)) === 'missing') return { outcome: 'missing' };

    const decided = await untilDecided(input, state);
    if (decided !== 'decided') return { outcome: decided };
    return { outcome: await afterDecision(input) };
  } finally {
    state.ended = true;
  }
}

/**
 * The request as it stands once the receiving transaction has ended (`requestState` retries
 * until it has); read again every `REQUEST_CHECK_INTERVAL` while the database cannot be reached.
 */
async function untilRecorded(input: AccessRequestWorkflowInput): Promise<RequestState> {
  for (;;) {
    const found = await check(input);
    if (found !== null) return found;
    await sleep(REQUEST_CHECK_INTERVAL);
  }
}

/**
 * The request read now; null when that failed after its retries (logged), so the wait goes on
 * and reads it again at its next check.
 */
async function check(input: AccessRequestWorkflowInput): Promise<RequestState | null> {
  try {
    return await requestState(input);
  } catch (error) {
    if (!(error instanceof ActivityFailure)) throw error;
    log.warn('Could not read the access request; reading it again later', {
      requestId: input.requestId,
    });
    return null;
  }
}

/** The stop a state read means, if any: decided, withdrawn, or not there. */
function stopOf(found: RequestState | null): Stop | null {
  return found === 'decided' || found === 'withdrawn' || found === 'missing' ? found : null;
}

/** Records a stop the request was read in, unless a signal came first; returns the run's stop. */
function stopWith(state: RunState, stop: Stop): Stop {
  state.stop ??= stop;
  return state.stop;
}

/**
 * Waits for the access officer to verify a passport applicant (S2): the `verified` signal, or
 * the request read as no longer held. Null once verified; the stop when the request closed.
 */
async function untilVerified(
  input: AccessRequestWorkflowInput,
  state: RunState,
): Promise<Stop | null> {
  for (;;) {
    await condition(() => state.verified || state.stop !== null, REQUEST_CHECK_INTERVAL);
    if (state.stop !== null) return state.stop;
    if (state.verified) return null;
    const found = await check(input);
    if (found === null || found === 'held') continue;
    const stop = stopOf(found);
    return stop === null ? null : stopWith(state, stop);
  }
}

/**
 * Waits for the officer named to be resolved (the `resolved` signal, or the request read as
 * resolved), then has the declarant notified: the end of their window, or how the run ended when
 * the officer cannot be identified or the request closed. Notifying that fails after its retries
 * is tried again at the next check. An officer with no account is invited to onboard, and the
 * wait goes on until they do (`onboarded`, or the directory read at a check) or the access
 * officer records the written notice served on them (`notified`); the window then runs from
 * that notice.
 */
async function untilNotified(
  input: AccessRequestWorkflowInput,
  state: RunState,
): Promise<string | AccessRequestResult> {
  for (;;) {
    await condition(() => state.resolved || state.stop !== null, REQUEST_CHECK_INTERVAL);
    if (state.stop !== null) return { outcome: state.stop };
    if (!state.resolved) {
      const found = await check(input);
      if (found === null || found === 'held' || found === 'unresolved') continue;
      const stop = stopOf(found);
      if (stop !== null) return { outcome: stopWith(state, stop) };
    }
    state.resolved = false;
    let resolved;
    try {
      resolved = await resolution(input);
    } catch (error) {
      if (!(error instanceof ActivityFailure)) throw error;
      log.warn('Could not notify on the resolution; trying again later', {
        requestId: input.requestId,
      });
      continue;
    }
    switch (resolved.outcome) {
      case 'notified':
        return resolved.windowEndsAt;
      case 'cannot-identify':
      case 'withdrawn':
      case 'missing':
        return { outcome: resolved.outcome };
      case 'unresolved':
      case 'awaiting-notice':
        continue;
    }
  }
}

/**
 * Holds the declarant's window for representations until `windowEndsAt`, unless they consent
 * (the `consented` signal, or the request read as `under-decision`) or the request stops.
 */
async function untilWindowEnds(
  input: AccessRequestWorkflowInput,
  state: RunState,
  windowEndsAt: number,
): Promise<void> {
  const settled = () => state.consented || state.stop !== null;
  for (;;) {
    const left = windowEndsAt - Date.now();
    if (left <= 0) return;
    await condition(settled, Math.min(left, REQUEST_CHECK_INTERVAL));
    if (settled() || windowEndsAt <= Date.now()) return;
    const found = await check(input);
    if (found === 'under-decision') return;
    const stop = stopOf(found);
    if (stop !== null) {
      stopWith(state, stop);
      return;
    }
  }
}

/**
 * Waits for the access officer's decision, or a withdrawal: the signals, or the request read as
 * decided or closed.
 */
async function untilDecided(input: AccessRequestWorkflowInput, state: RunState): Promise<Stop> {
  for (;;) {
    await condition(() => state.stop !== null, REQUEST_CHECK_INTERVAL);
    if (state.stop !== null) return state.stop;
    const stop = stopOf(await check(input));
    if (stop !== null) return stopWith(state, stop);
  }
}

/**
 * The run's result at a stop. One run follows a request and a request is decided once, so a
 * decision the run stops at before its decision step is one nobody has carried out: it is
 * carried out now. The run can lag that far: a written notice consented to in writing goes
 * under decision at once, and the `notified` and `decided` signals then arrive together, or are
 * lost and the request is read decided.
 */
async function carriedOut(
  input: AccessRequestWorkflowInput,
  result: AccessRequestResult,
): Promise<AccessRequestResult> {
  return result.outcome === 'decided' ? { outcome: await afterDecision(input) } : result;
}

/**
 * The decision is final (S6): both parties are told. A grant (full or partial) has its scoped
 * disclosure rendered by declarations and issued by documents as the applicant's Confidential,
 * watermarked package (or, when the scope holds nothing, the nil letter), the applicant is told
 * it is ready, and at the end of its download window the register records it `expired` (S7).
 */
async function afterDecision(input: AccessRequestWorkflowInput): Promise<'decided' | 'missing'> {
  const decided = await decisionNotices(input);
  if (decided !== 'granted') return decided === 'missing' ? 'missing' : 'decided';

  let issued;
  try {
    issued = await issuePackage(input);
  } catch (error) {
    // Recorded on the request, so the parties see it failed; the run fails for an operator.
    if (error instanceof ActivityFailure) await packageFailed(input);
    throw error;
  }
  if (issued.outcome === 'missing') return 'missing';
  await packageReady(input);

  const open = new Date(issued.downloadExpiresAt).getTime() - Date.now();
  if (open > 0) await sleep(open);
  return (await expirePackage(input)) === 'missing' ? 'missing' : 'decided';
}

/**
 * The access officers' reminders: day five from receipt, then ten and two days before the decision
 * deadline (`reminderDueAt`). One whose next reminder is due already
 * (a run that fell behind, e.g. after an outage) is passed over, so a late run sends one
 * reminder, not several. A reminder that fails after its retries is logged and passed over.
 */
async function reminders(input: AccessRequestWorkflowInput, state: RunState): Promise<void> {
  const done = () => state.ended || state.stop !== null;
  for (const [index, day] of OFFICER_REMINDER_DAYS.entries()) {
    const wait = reminderDueAt(input, day).getTime() - Date.now();
    if (wait > 0) await condition(done, wait);
    if (done()) return;
    const next = OFFICER_REMINDER_DAYS[index + 1];
    if (next !== undefined && reminderDueAt(input, next).getTime() <= Date.now()) {
      continue;
    }
    let reminded;
    try {
      reminded = await remindOfficer({ ...input, day });
    } catch (error) {
      if (!(error instanceof ActivityFailure)) throw error;
      log.warn('Could not remind the access officers', { requestId: input.requestId, day });
      continue;
    }
    if (reminded === 'missing') {
      state.stop ??= 'missing';
      return;
    }
  }
}
