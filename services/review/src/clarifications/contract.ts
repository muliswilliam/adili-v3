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
 * retried or repeated run), found the clarification `not-issued` yet (the workflow is started
 * inside the issue transaction, so its first attempt can run before that transaction commits), or
 * found it `withdrawn` before any letter was asked for.
 */
export type LetterOutcome = 'requested' | 'already-requested' | 'not-issued' | 'withdrawn';

/** notifications.yaml `Channel`, in the order the declarant is told. */
export const NOTICE_CHANNELS = ['email', 'sms'] as const;
export type NoticeChannel = (typeof NOTICE_CHANNELS)[number];

/** The messages the declarant gets about a clarification: the notice of issue and the reminder. */
export type Notice = 'issued' | 'reminder';

export interface NotifyRequest extends ClarificationWorkflowInput {
  notice: Notice;
  channel: NoticeChannel;
}

/**
 * What became of one message: handed to the provider, `failed` there (e.g. no verified contact
 * on the channel), `rejected` by notifications (the request itself was refused), or `skipped`: a
 * reminder for a clarification no longer awaiting the declarant is not sent.
 */
export type NotifyOutcome = 'sent' | 'failed' | 'rejected' | 'skipped';

/**
 * The signals that end the workflow's clock, sent after the transaction that made the change
 * commits. They only save waiting: the activities read the clarification before acting, so a
 * reminder or an overdue mark never follows a response, a withdrawal or a resolution.
 */
export const CLARIFICATION_SIGNALS = ['responded', 'withdrawn', 'resolved'] as const;
export type ClarificationSignal = (typeof CLARIFICATION_SIGNALS)[number];

/** The day after issue the declarant is reminded, unless they have responded (spec 07a). */
export const REMINDER_DAY = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the clock is set from, read by `clarificationClock` when the workflow starts its clock: the
 * issue time and the due date stored at issue. A policy change after issue moves neither.
 */
export interface ClarificationClock {
  /** ISO 8601. */
  issuedAt: string;
  /** ISO 8601. */
  dueAt: string;
}

/** The due date of a clarification issued at `issuedAt`: the Commission's reply window later. */
export function clarificationDueAt(issuedAt: Date, replyWindowDays: number): Date {
  return new Date(issuedAt.getTime() + replyWindowDays * DAY_MS);
}

/**
 * The reminder: twenty days after issue. A clarification due within twenty days of issue has no
 * reminder: it would come on or after the due date.
 */
export function reminderAt(issuedAt: Date, dueAt: Date): Date | null {
  const reminder = new Date(issuedAt.getTime() + REMINDER_DAY * DAY_MS);
  return reminder < dueAt ? reminder : null;
}

/**
 * How a run ended: the clarification never got issued, or it was withdrawn before its letter; the
 * clock ended on a signal; or the due date passed without a response (`overdue`).
 */
export type ClarificationResult =
  { outcome: 'not-issued' } | { outcome: ClarificationSignal } | { outcome: 'overdue' };

/** Failure type of a clarification that disappeared; not retried. */
export const CLARIFICATION_MISSING = 'clarification-missing';

/** Failure type of a letter the documents service refused; not retried. */
export const LETTER_REFUSED = 'letter-refused';
