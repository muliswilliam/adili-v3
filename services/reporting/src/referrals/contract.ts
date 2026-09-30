/**
 * What passes between `ReferralIcmsRegistrationWorkflow`, its activities and the service that
 * starts it. Bundled into the workflow sandbox: types and constants only. The referral id and the
 * push attempt only: the declarant's name and ID number never reach Temporal history, and the
 * case number is stored by the activity that reads it.
 */

/** Workflow type name, for starting by name (the worker bundles the code, not the caller). */
export const REFERRAL_ICMS_REGISTRATION_WORKFLOW = 'referralIcmsRegistration';

/** One registration workflow per push of a referral. */
export function referralIcmsRegistrationWorkflowId(referralId: string, attempt: number): string {
  return `referral-icms-registration:${referralId}:${String(attempt)}`;
}

/** ICMS accepted a push without a case number: which referral, and which push of it. */
export interface IcmsRegistrationInput {
  referralId: string;
  /** The push (`referral_intake.push_attempts`) the workflow waits for; a later push supersedes. */
  attempt: number;
}

/**
 * Where the registration stands after a check: a case number stored (`registered`), still
 * waiting (`pending`), refused by ICMS (`failed`), or no longer this workflow's to wait for
 * (`superseded`: registered by another push, or pushed again).
 */
export type IcmsCheckOutcome = 'registered' | 'pending' | 'failed' | 'superseded';

export interface IcmsRegistrationResult {
  outcome: IcmsCheckOutcome | 'timed-out';
  checks: number;
}

/**
 * How the workflow waits for ICMS to give a case number: the first check a minute after the
 * push, each later one twice as late, at most an hour apart, for at most seven days.
 */
export const ICMS_CHECK_FIRST_DELAY_MS = 60_000;
export const ICMS_CHECK_MAX_DELAY_MS = 60 * 60_000;
export const ICMS_REGISTRATION_TIMEOUT_MS = 7 * 24 * 60 * 60_000;
