/**
 * `ClarificationWorkflow` (ADR-003), hosted by the review worker next to
 * `DeclarationProcessingWorkflow`. Bundled into Temporal's deterministic sandbox: import only
 * `@temporalio/workflow` and types.
 */
import { condition, defineSignal, proxyActivities, setHandler, sleep } from '@temporalio/workflow';

import type { ClarificationActivities } from './activities.js';
import {
  CLARIFICATION_SIGNALS,
  clarificationDeadlines,
  type ClarificationResult,
  type ClarificationSignal,
  type ClarificationWorkflowInput,
  NOTICE_CHANNELS,
  type Notice,
} from './contract.js';

/**
 * Calls to documents, notifications, the directory and the database: retried with backoff until
 * they succeed, so an outage delays the letter or a message, never loses it. The first retry comes
 * after a second, each later one twice as late, at most five minutes apart.
 */
const RETRY = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '5 minutes',
} as const;

const { requestLetter, notifyDeclarant, clarificationClock, recordReminder, markOverdue } =
  proxyActivities<ClarificationActivities>({
    // Rendering and signing a letter takes seconds.
    startToCloseTimeout: '2 minutes',
    retry: RETRY,
  });

/**
 * How long the workflow waits for the issue transaction that started it to commit, in one-second
 * steps. It only waits longer than a moment when that transaction rolled back, and then the
 * clarification is still a draft: the run ends and issuing it again starts a new one.
 */
const COMMIT_WAIT_SECONDS = 60;

/**
 * `ClarificationWorkflow(clarificationId)` (spec 07a), started by the issue transaction with the
 * clarification as workflow id: request the Restricted letter from documents (which pulls its
 * fields from the review service), tell the declarant by email and SMS, then run the clock set
 * from the issue time and the Commission's reply window: a reminder at day twenty unless the
 * declarant has responded, and at the due date the clarification is marked `overdue` (spec 08
 * escalates). The `responded`, `withdrawn` and `resolved` signals end the clock.
 */
export async function clarification(
  input: ClarificationWorkflowInput,
): Promise<ClarificationResult> {
  let signal: ClarificationSignal | null = null;
  for (const name of CLARIFICATION_SIGNALS) {
    setHandler(defineSignal(name), () => {
      signal ??= name;
    });
  }
  const signalled = () => signal;

  const letter = await letterRequested(input);
  if (letter !== 'requested') return { outcome: letter };
  const early = signalled();
  if (early !== null) return { outcome: early };
  await notify(input, 'issued');

  const clock = await clarificationClock(input);
  const { reminderAt, dueAt } = clarificationDeadlines(
    new Date(clock.issuedAt),
    clock.replyWindowDays,
  );
  if (reminderAt !== null) {
    const beforeReminder = await signalledBefore(reminderAt, signalled);
    if (beforeReminder !== null) return { outcome: beforeReminder };
    await notify(input, 'reminder');
    await recordReminder(input);
  }
  const beforeDue = await signalledBefore(dueAt, signalled);
  if (beforeDue !== null) return { outcome: beforeDue };
  await markOverdue(input);
  return { outcome: 'overdue' };
}

async function notify(input: ClarificationWorkflowInput, notice: Notice): Promise<void> {
  for (const channel of NOTICE_CHANNELS) {
    await notifyDeclarant({ ...input, notice, channel });
  }
}

/** Waits until `at` (workflow time) or a signal, whichever comes first; the signal, if any. */
async function signalledBefore(
  at: Date,
  signalled: () => ClarificationSignal | null,
): Promise<ClarificationSignal | null> {
  const wait = at.getTime() - Date.now();
  if (wait > 0) await condition(() => signalled() !== null, wait);
  return signalled();
}

/** Requests the letter once the clarification is issued; `not-issued` if it never was. */
async function letterRequested(
  input: ClarificationWorkflowInput,
): Promise<'requested' | 'not-issued' | 'withdrawn'> {
  for (let waited = 0; ; waited += 1) {
    const outcome = await requestLetter(input);
    if (outcome === 'withdrawn') return 'withdrawn';
    if (outcome !== 'not-issued') return 'requested';
    if (waited >= COMMIT_WAIT_SECONDS) return 'not-issued';
    await sleep('1 second');
  }
}
