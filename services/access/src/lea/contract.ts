/**
 * What passes between `LeaRequestWorkflow`, its activities and the transactions that start and
 * signal it. Bundled into the workflow sandbox: types and constants only.
 *
 * Identifiers and instants only: the activities read the request where they use it, so no names,
 * reasons, case references or LEA references enter Temporal's history.
 */

/** Workflow type name, for starting by name (the worker bundles the code, not the caller). */
export const LEA_REQUEST_WORKFLOW = 'leaRequest';

/** One workflow per law enforcement request, from receipt. */
export function leaRequestWorkflowId(requestId: string): string {
  return `lea-request:${requestId}`;
}

/** The request the workflow follows, from the transaction that received it. */
export interface LeaRequestWorkflowInput {
  tenant: string;
  requestId: string;
  /** ISO 8601: received (the reminder counts its days from it). */
  receivedAt: string;
  /** ISO 8601: the decision deadline (received + `LEA_DECISION_DAYS`, fourteen). */
  deadlineAt: string;
  /**
   * The receiving transaction (Postgres `xid8`): the workflow reads the request only once it has
   * ended (workflow-control.ts).
   */
  transactionId: string;
}

/**
 * The signals that tell the workflow the request changed, sent once the transaction that changed
 * it commits: the access officer decided, or the request was withdrawn. They only save waiting:
 * the activities read the request before acting, and the workflow reads it every
 * `LEA_REQUEST_CHECK_INTERVAL` without a signal, so a lost signal delays it, never stalls it.
 */
export const LEA_REQUEST_SIGNALS = ['decided', 'withdrawn'] as const;
export type LeaRequestSignal = (typeof LEA_REQUEST_SIGNALS)[number];

/**
 * Days after receipt the access officers are reminded while the request is undecided (spec 10,
 * S11). At the deadline (day fourteen) an undecided request is flagged as breached.
 */
export const LEA_REMINDER_DAY = 10;

/**
 * What a reminder or the breach flag did: done (`sent` / `flagged`), `skipped` because the
 * request is decided or closed, or the request is `missing`.
 */
export type LeaReminderOutcome = 'sent' | 'skipped' | 'missing';
export type LeaBreachOutcome = 'flagged' | 'skipped' | 'missing';

/**
 * Where the request stands, read from the request itself (`leaRequestState`): first, once the
 * receiving transaction has ended, then whenever the wait for the decision has had no signal for
 * `LEA_REQUEST_CHECK_INTERVAL`. `missing`: the receiving transaction rolled back.
 */
export type LeaRequestState = 'undecided' | 'decided' | 'withdrawn' | 'missing';

/**
 * How often the workflow reads the request while it waits for the decision, in case the
 * `decided` or `withdrawn` signal was lost (milliseconds, six hours).
 */
export const LEA_REQUEST_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/** What the decision's notice to the agency found: a grant (full or partial), a denial, or none. */
export type LeaDecisionNoticeOutcome = 'granted' | 'denied' | 'missing';

/**
 * What became of a grant's package: `issued`, downloadable by the officer until
 * `downloadExpiresAt`; `nothing-to-disclose` (no declaration of the declarant in the granted
 * scope); or the request is `missing`.
 */
export type LeaPackageOutcome =
  { outcome: 'issued'; downloadExpiresAt: string } | { outcome: 'nothing-to-disclose' | 'missing' };

/** How a run ended (`missing`: its receipt rolled back after the workflow started). */
export interface LeaRequestResult {
  outcome: 'decided' | 'withdrawn' | 'missing';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant `day` days after receipt. */
export function dayAfterLeaReceipt(receivedAt: string, day: number): Date {
  return new Date(new Date(receivedAt).getTime() + day * DAY_MS);
}
