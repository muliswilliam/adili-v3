/**
 * `DeterminationIssuanceWorkflow` (ADR-003), hosted by the review worker. Bundled into Temporal's
 * deterministic sandbox: import only `@temporalio/workflow` and types.
 */
import { proxyActivities, sleep } from '@temporalio/workflow';

import type { DeterminationActivities } from './activities.js';
import {
  DECISION_CHANNELS,
  type DeterminationIssuanceInput,
  type DeterminationIssuanceResult,
} from './contract.js';

/**
 * Calls to documents, notifications, the directory and the database: retried with backoff until
 * they succeed, so an outage delays the letter or a message, never loses it.
 */
const RETRY = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '5 minutes',
} as const;

const { requestDecisionLetter, notifyDecision } = proxyActivities<DeterminationActivities>({
  // Rendering and signing a letter takes seconds.
  startToCloseTimeout: '2 minutes',
  retry: RETRY,
});

/**
 * How long the workflow waits for the approval transaction that started it to commit, in
 * one-second steps. It only waits longer than a moment when that transaction rolled back, and then
 * the determination is still proposed: the run ends and approving it again starts a new one.
 */
const COMMIT_WAIT_SECONDS = 60;

/**
 * `DeterminationIssuanceWorkflow(determinationId)` (spec 08), started by the approval transaction
 * with the determination as workflow id: request the Restricted decision letter from documents
 * (which pulls its fields from the review service), then tell the declarant by email and SMS.
 */
export async function determinationIssuance(
  input: DeterminationIssuanceInput,
): Promise<DeterminationIssuanceResult> {
  for (let waited = 0; ; waited += 1) {
    const outcome = await requestDecisionLetter(input);
    if (outcome !== 'not-approved') break;
    if (waited >= COMMIT_WAIT_SECONDS) return { outcome: 'not-approved' };
    await sleep('1 second');
  }
  for (const channel of DECISION_CHANNELS) {
    await notifyDecision({ ...input, channel });
  }
  return { outcome: 'issued' };
}
