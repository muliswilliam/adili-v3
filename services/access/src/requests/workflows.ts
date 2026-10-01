/**
 * `AccessRequestWorkflow` (ADR-003), hosted by the access worker. Bundled into Temporal's
 * deterministic sandbox: import only `@temporalio/workflow` and types.
 */
import { condition, defineSignal, proxyActivities, setHandler, sleep } from '@temporalio/workflow';

import type { AccessRequestActivities } from './activities.js';
import {
  ACCESS_REQUEST_SIGNALS,
  type AccessRequestResult,
  type AccessRequestSignal,
  type AccessRequestWorkflowInput,
  dayAfterReceipt,
  DECISION_CHECK_INTERVAL,
  OFFICER_REMINDER_DAYS,
} from './contract.js';
import type { DecisionActivities } from './decision-activities.js';

/**
 * Calls to the directory, notifications and the database: retried with backoff until they
 * succeed, so an outage delays a notice or a reminder, never loses it. The first retry comes after
 * a second, each later one twice as late, at most five minutes apart.
 */
const RETRY = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '5 minutes',
} as const;

const { resolution, closeWindow, remindOfficer } = proxyActivities<AccessRequestActivities>({
  // A transaction and a few messages.
  startToCloseTimeout: '1 minute',
  retry: RETRY,
});

const { decisionState, decisionNotices, packageReady, expirePackage } =
  proxyActivities<DecisionActivities>({
    // A transaction and a few messages.
    startToCloseTimeout: '1 minute',
    retry: RETRY,
  });

const { issuePackage } = proxyActivities<DecisionActivities>({
  // The disclosure from declarations (2 s per attempt), rendering and signing at documents
  // (30 s per attempt, ADR-013 §2), then a transaction.
  startToCloseTimeout: '3 minutes',
  retry: RETRY,
});

/** What ends the run early: the applicant withdrew, the officer decided, or no request is there. */
type Stop = 'withdrawn' | 'decided' | 'missing';

/** What the signals told the run so far. */
interface RunState {
  resolved: boolean;
  consented: boolean;
  stop: Stop | null;
  /** The request's own course has ended: the reminders stop too. */
  ended: boolean;
}

/**
 * `AccessRequestWorkflow(requestId)` (spec 10, Act s.36(3)), started when a request is
 * `submitted` (at receipt, or when the access officer verifies a passport applicant) with the
 * request as workflow id. It waits for the access officer to resolve the officer Form K names;
 * then it notifies the declarant and holds the window for representations (seven days) unless
 * they consent earlier, after which the request is `under-decision` until the officer decides.
 * The decision is told to both parties; a grant's package is issued to the applicant, who is
 * told it is ready, and it expires at the end of its download window (fourteen days).
 * Alongside, the access officers are reminded at day five while the officer is unidentified and
 * of the thirty-day deadline at days twenty and twenty-eight. A request the officer cannot
 * identify closes, with the applicant told. Withdrawal ends it at any point before the decision.
 */
export async function accessRequest(
  input: AccessRequestWorkflowInput,
): Promise<AccessRequestResult> {
  const state: RunState = { resolved: false, consented: false, stop: null, ended: false };
  const on: Record<AccessRequestSignal, () => void> = {
    resolved: () => {
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

  const [result] = await Promise.all([course(input, state), reminders(input, state)]);
  return result;
}

/** Resolution, the declarant's notice and window, then the decision and what follows it. */
async function course(
  input: AccessRequestWorkflowInput,
  state: RunState,
): Promise<AccessRequestResult> {
  try {
    const notified = await untilNotified(input, state);
    if (typeof notified !== 'string') return notified;

    const window = new Date(notified).getTime() - Date.now();
    if (window > 0) await condition(() => state.consented || state.stop !== null, window);
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
 * Waits for the access officer's decision, or a withdrawal. The signals save waiting; every
 * `DECISION_CHECK_INTERVAL` without one the request itself is read, so a signal lost after its
 * transaction committed delays the decision's notices and package, never loses them.
 */
async function untilDecided(input: AccessRequestWorkflowInput, state: RunState): Promise<Stop> {
  for (;;) {
    await condition(() => state.stop !== null, DECISION_CHECK_INTERVAL);
    if (state.stop !== null) return state.stop;
    const found = await decisionState(input);
    if (found !== 'undecided') {
      state.stop = found;
      return found;
    }
  }
}

/**
 * The decision is final (S6): both parties are told. A grant (full or partial) has its scoped
 * disclosure rendered by declarations and issued by documents as the applicant's Confidential,
 * watermarked package, the applicant is told it is ready, and at the end of its download window
 * the register records it `expired` (S7).
 */
async function afterDecision(input: AccessRequestWorkflowInput): Promise<'decided' | 'missing'> {
  const decided = await decisionNotices(input);
  if (decided !== 'granted') return decided === 'missing' ? 'missing' : 'decided';

  const issued = await issuePackage(input);
  // Nothing to disclose: the decision stands, with no package to issue.
  if (issued.outcome !== 'issued') return issued.outcome === 'missing' ? 'missing' : 'decided';
  await packageReady(input);

  const open = new Date(issued.downloadExpiresAt).getTime() - Date.now();
  if (open > 0) await sleep(open);
  return (await expirePackage(input)) === 'missing' ? 'missing' : 'decided';
}

/**
 * Waits for the officer named to be resolved, then has the declarant notified: the end of their
 * window, or how the run ended when the officer cannot be identified or the request closed.
 */
async function untilNotified(
  input: AccessRequestWorkflowInput,
  state: RunState,
): Promise<string | AccessRequestResult> {
  for (;;) {
    await condition(() => state.resolved || state.stop !== null);
    if (state.stop !== null) return { outcome: state.stop };
    state.resolved = false;
    const resolved = await resolution(input);
    switch (resolved.outcome) {
      case 'notified':
        return resolved.windowEndsAt;
      case 'cannot-identify':
      case 'withdrawn':
      case 'missing':
        return { outcome: resolved.outcome };
      case 'unresolved':
        continue;
    }
  }
}

/**
 * The access officers' reminders, counted from receipt. One whose next reminder is due already
 * (a request held for the applicant's verification and released late) is passed over, so a late
 * start sends one reminder, not several.
 */
async function reminders(input: AccessRequestWorkflowInput, state: RunState): Promise<void> {
  const done = () => state.ended || state.stop !== null;
  for (const [index, day] of OFFICER_REMINDER_DAYS.entries()) {
    const wait = dayAfterReceipt(input.submittedAt, day).getTime() - Date.now();
    if (wait > 0) await condition(done, wait);
    if (done()) return;
    const next = OFFICER_REMINDER_DAYS[index + 1];
    if (next !== undefined && dayAfterReceipt(input.submittedAt, next).getTime() <= Date.now()) {
      continue;
    }
    if ((await remindOfficer({ ...input, day })) === 'missing') {
      state.stop ??= 'missing';
      return;
    }
  }
}
