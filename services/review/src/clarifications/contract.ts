/**
 * What passes between `ClarificationWorkflow`, its activities and the issue transaction that
 * starts it. Bundled into the workflow sandbox: types and constants only.
 *
 * Identifiers only: the activities read the clarification where they use it, so no names,
 * references or item texts enter Temporal's history.
 */

/** Workflow type name, for starting by name (the worker bundles the code, not the caller). */
export const CLARIFICATION_WORKFLOW = 'clarification';

/** One workflow per issued clarification. */
export function clarificationWorkflowId(clarificationId: string): string {
  return `clarification:${clarificationId}`;
}

/** The clarification the workflow follows, from the issue transaction. */
export interface ClarificationWorkflowInput {
  tenant: string;
  clarificationId: string;
}

/**
 * What `requestLetter` did: asked documents for the letter, found it `already-requested` (a
 * retried or repeated run), or found the clarification `not-issued` yet: the workflow is started
 * inside the issue transaction, so its first attempt can run before that transaction commits.
 */
export type LetterOutcome = 'requested' | 'already-requested' | 'not-issued';

/** notifications.yaml `Channel`, in the order the declarant is told. */
export const NOTICE_CHANNELS = ['email', 'sms'] as const;
export type NoticeChannel = (typeof NOTICE_CHANNELS)[number];

/** The messages the declarant gets about a clarification; #174 adds the day-20 reminder. */
export type Notice = 'issued';

export interface NotifyRequest extends ClarificationWorkflowInput {
  notice: Notice;
  channel: NoticeChannel;
}

/**
 * What became of one message: handed to the provider, `failed` there (e.g. no verified contact
 * on the channel), or `rejected` by notifications (the request itself was refused).
 */
export type NotifyOutcome = 'sent' | 'failed' | 'rejected';

/** How a run ended: the declarant was told, or the clarification never got issued. */
export type ClarificationResult = { outcome: 'notified' } | { outcome: 'not-issued' };

/** Failure type of a clarification that disappeared; not retried. */
export const CLARIFICATION_MISSING = 'clarification-missing';

/** Failure type of a letter the documents service refused; not retried. */
export const LETTER_REFUSED = 'letter-refused';
