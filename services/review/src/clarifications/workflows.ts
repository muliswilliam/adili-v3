/**
 * `ClarificationWorkflow` (ADR-003), hosted by the review worker next to
 * `DeclarationProcessingWorkflow`. Bundled into Temporal's deterministic sandbox: import only
 * `@temporalio/workflow` and types.
 */
import { proxyActivities, sleep } from '@temporalio/workflow';

import type { ClarificationActivities } from './activities.js';
import {
  type ClarificationResult,
  type ClarificationWorkflowInput,
  NOTICE_CHANNELS,
} from './contract.js';

/**
 * Calls to documents, notifications and the database: retried with backoff until they succeed,
 * so an outage delays the letter or a message, never loses it. The first retry comes after a
 * second, each later one twice as late, at most five minutes apart.
 */
const RETRY = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '5 minutes',
} as const;

const { requestLetter, notifyDeclarant } = proxyActivities<ClarificationActivities>({
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
 * fields from the review service), then tell the declarant by email and SMS.
 *
 * #174 adds the thirty-day clock after the notices: a reminder at day twenty unless responded,
 * `overdue` at the due date, and the `responded`, `withdrawn` and `resolved` signals that end it.
 */
export async function clarification(
  input: ClarificationWorkflowInput,
): Promise<ClarificationResult> {
  if (!(await letterRequested(input))) return { outcome: 'not-issued' };
  for (const channel of NOTICE_CHANNELS) {
    await notifyDeclarant({ ...input, notice: 'issued', channel });
  }
  return { outcome: 'notified' };
}

/** Requests the letter once the clarification is issued; false if it never was. */
async function letterRequested(input: ClarificationWorkflowInput): Promise<boolean> {
  for (let waited = 0; ; waited += 1) {
    if ((await requestLetter(input)) !== 'not-issued') return true;
    if (waited >= COMMIT_WAIT_SECONDS) return false;
    await sleep('1 second');
  }
}
