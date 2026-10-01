import type { IcmsPushError } from './schema.js';

/**
 * Events the reporting service publishes about EACC's hand-off of referrals to ICMS (spec 09,
 * outbox, CloudEvents). Identifiers, the `RFL` reference, the ICMS case number, statuses and error
 * codes only: never the declarant's name or ID number, the grounds text or the narrative. The
 * tenant extension is the Commission that sent the referral (its slug) and the subject the
 * referral id, so the review service's inbox finds the Commission's referral under its own
 * row-level security.
 */

export const REFERRAL_ICMS_PUSHED = 'referral.icms-pushed.v1';

/** `referral.icms-pushed.v1`: ICMS accepted the referral and has not given a case number yet. */
export interface ReferralIcmsPushedData extends Record<string, unknown> {
  referralId: string;
  /** The Commission's slug (also the CloudEvents `tenant` extension). */
  tenant: string;
  reference: string;
  /** ISO 8601. */
  pushedAt: string;
}

export const REFERRAL_ICMS_REGISTERED = 'referral.icms-registered.v1';

/**
 * `referral.icms-registered.v1`: ICMS registered the referral under a case number. The review
 * service (spec 08 referrals) consumes it to show "ICMS case {number}" on the Commission's
 * referral. Published once per referral.
 */
export interface ReferralIcmsRegisteredData extends Record<string, unknown> {
  referralId: string;
  /** The Commission's slug (also the CloudEvents `tenant` extension). */
  tenant: string;
  /** ICMS's case number: EACC's investigation owns the referral from here. */
  icmsCaseNumber: string;
  /** ISO 8601: when ICMS registered it. */
  registeredAt: string;
}

export const REFERRAL_ICMS_PUSH_FAILED = 'referral.icms-push-failed.v1';

/** `referral.icms-push-failed.v1`: the push could not be completed; EACC pushes again to retry. */
export interface ReferralIcmsPushFailedData extends Record<string, unknown> {
  referralId: string;
  /** The Commission's slug (also the CloudEvents `tenant` extension). */
  tenant: string;
  reference: string;
  error: IcmsPushError;
}
