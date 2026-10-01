/**
 * What passes between `AccessRequestWorkflow`, its activities and the transactions that start and
 * signal it. Bundled into the workflow sandbox: types and constants only.
 *
 * Identifiers and instants only: the activities read the request where they use it, so no names,
 * Form K text or references enter Temporal's history.
 */

/** Workflow type name, for starting by name (the worker bundles the code, not the caller). */
export const ACCESS_REQUEST_WORKFLOW = 'accessRequest';

/** One workflow per access request that goes ahead (`submitted`). */
export function accessRequestWorkflowId(requestId: string): string {
  return `access-request:${requestId}`;
}

/**
 * The request the workflow follows, from the transaction that made it `submitted` (receipt, or
 * the access officer's verification of a passport applicant). Its clock runs from receipt.
 */
export interface AccessRequestWorkflowInput {
  tenant: string;
  requestId: string;
  /** ISO 8601: received (the reminders count their days from it). */
  submittedAt: string;
}

/**
 * The signals that tell the workflow the request changed, sent once the transaction that changed
 * it commits: the access officer resolved the officer named (or recorded that they cannot be
 * identified), the declarant consented, the applicant withdrew, the access officer decided. They
 * only save waiting: the activities read the request before acting.
 */
export const ACCESS_REQUEST_SIGNALS = ['resolved', 'consented', 'withdrawn', 'decided'] as const;
export type AccessRequestSignal = (typeof ACCESS_REQUEST_SIGNALS)[number];

/**
 * Days after receipt the access officer is reminded (spec 10): to identify the officer at day
 * five while they have not, and of the decision deadline (day thirty) at days twenty and
 * twenty-eight. Day five also marks the request `officer-unresolved`.
 */
export const IDENTIFY_REMINDER_DAY = 5;
export const DEADLINE_REMINDER_DAYS = [20, 28] as const;
export const OFFICER_REMINDER_DAYS = [IDENTIFY_REMINDER_DAY, ...DEADLINE_REMINDER_DAYS] as const;
export type OfficerReminderDay = (typeof OFFICER_REMINDER_DAYS)[number];

export interface OfficerReminderRequest extends AccessRequestWorkflowInput {
  day: OfficerReminderDay;
}

/**
 * What a reminder did: sent to the Commission's access officers, `skipped` because the request no
 * longer waits for them on that point (resolved before day five, decided or closed), or the
 * request is `missing` (its receipt rolled back after the workflow started).
 */
export type OfficerReminderOutcome = 'sent' | 'skipped' | 'missing';

/**
 * What became of a resolution: the declarant `notified` and their window for representations
 * open until `windowEndsAt`; the officer `cannot-identify` and the applicant told; nothing to do
 * because the request is still `unresolved` (a signal without a resolution behind it), was
 * `withdrawn` meanwhile, or is `missing`.
 */
export type ResolutionOutcome =
  | { outcome: 'notified'; windowEndsAt: string }
  | { outcome: 'cannot-identify' | 'unresolved' | 'withdrawn' | 'missing' };

/**
 * What closing the window did: the request is now `under-decision`, or was `unchanged` (the
 * declarant consented earlier, or the request closed), or is `missing`.
 */
export type WindowOutcome = 'under-decision' | 'unchanged' | 'missing';

/**
 * How a run ended: the applicant withdrew, the access officer decided, the officer named could
 * not be identified, or the request was not there (its receipt rolled back).
 */
export interface AccessRequestResult {
  outcome: 'withdrawn' | 'decided' | 'cannot-identify' | 'missing';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant `day` days after receipt. */
export function dayAfterReceipt(submittedAt: string, day: number): Date {
  return new Date(new Date(submittedAt).getTime() + day * DAY_MS);
}
