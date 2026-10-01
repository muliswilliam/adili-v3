/**
 * What passes between `DeterminationIssuanceWorkflow`, its activities and the approval that starts
 * it. Bundled into the workflow sandbox: types and constants only.
 *
 * Identifiers only: the activities read the determination where they use it, so no names,
 * references, outcomes or reasons enter Temporal's history.
 */

/** Workflow type name, for starting by name (the worker bundles the code, not the caller). */
export const DETERMINATION_ISSUANCE_WORKFLOW = 'determinationIssuance';

/** One workflow per approved determination. */
export function determinationIssuanceWorkflowId(determinationId: string): string {
  return `determination-issuance:${determinationId}`;
}

/** The approved determination, from the approval transaction. */
export interface DeterminationIssuanceInput {
  tenant: string;
  determinationId: string;
}

/**
 * What `requestDecisionLetter` did: asked documents for the letter, found it `already-requested`
 * (a retried or repeated run), or found the determination `not-approved` yet (the workflow is
 * started inside the approval transaction, so its first attempt can run before that commits).
 */
export type DecisionLetterOutcome = 'requested' | 'already-requested' | 'not-approved';

/** notifications.yaml `Channel`, in the order the declarant is told. */
export const DECISION_CHANNELS = ['email', 'sms'] as const;
export type DecisionChannel = (typeof DECISION_CHANNELS)[number];

export interface DecisionNotice extends DeterminationIssuanceInput {
  channel: DecisionChannel;
}

/**
 * What became of one message: handed to the provider, `failed` there (no verified contact on the
 * channel, say), or `rejected` by notifications (the request itself was refused).
 */
export type DecisionNoticeOutcome = 'sent' | 'failed' | 'rejected';

/** How a run ended: the letter was requested and the declarant told, or it never got approved. */
export type DeterminationIssuanceResult = { outcome: 'issued' } | { outcome: 'not-approved' };

/** Failure type of a determination that disappeared; not retried. */
export const DETERMINATION_MISSING = 'determination-missing';

/** Failure type of a decision letter the documents service refused; not retried. */
export const DECISION_LETTER_REFUSED = 'decision-letter-refused';
