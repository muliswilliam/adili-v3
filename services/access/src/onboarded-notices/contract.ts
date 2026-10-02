/**
 * `OnboardedNoticeWorkflow`: the online notice owed to a declarant who onboarded after the access
 * officer served them in writing (spec 10 decision 2). Bundled into Temporal's deterministic
 * sandbox: constants and types only.
 */

/** Started by name: the worker bundles the code, not the process that starts it. */
export const ONBOARDED_NOTICE_WORKFLOW = 'onboardedNotice';

/** One run per request linked to the declarant who onboarded. */
export function onboardedNoticeWorkflowId(requestId: string): string {
  return `access-onboarded-notice:${requestId}`;
}

export interface OnboardedNoticeWorkflowInput {
  tenant: string;
  /** A Form K request (`access_requests`) or a law enforcement request (`lea_requests`). */
  requestKind: 'form-k' | 'lea';
  requestId: string;
  /** The transaction that linked the request (`currentTransactionId`), awaited before reading. */
  transactionId: string;
}

/**
 * What the declarant was told online: the Form K notice (window still open), the Form K decision,
 * the law enforcement grant; nothing when no notice matters any more (the window closed with no
 * decision yet: the decision's notice reaches them when it is taken; withdrawn), or the request
 * is not there.
 */
export type OnboardedNoticeOutcome =
  'notice' | 'decision' | 'grant-notice' | 'not-relevant' | 'missing';

export interface OnboardedNoticeResult {
  outcome: OnboardedNoticeOutcome;
}
