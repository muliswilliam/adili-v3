import { PLATFORM_TENANT } from '@adili/api-kit';
import type { NewEvent } from '@adili/events';

import type { IcmsStatus, InstructionLegalBasis, UnavailableReason } from '../db/schema.js';

/**
 * ICMS answered a referral the gateway sent (ADR-008: integration calls are audited with their
 * legal basis): registered with a case number. Once per referral reference: a replay emits
 * nothing. Identifiers and statuses only, never the national ID or the name.
 * Subject: the referral reference; tenant: `platform`, as referrals act for no tenant. The
 * reporting service's own `referral.icms-registered.v1` ties it to EACC's intake. Documented here
 * until the AsyncAPI file lands.
 */
export const ICMS_REFERRAL_SUBMITTED = 'icms.referral.submitted.v1';

export interface IcmsReferralSubmittedData extends Record<string, unknown> {
  referralReference: string;
  /** The referring Commission's issuer code. */
  referringCommission: string;
  status: IcmsStatus;
  caseNumber: string;
  legalBasis: InstructionLegalBasis;
  caseRef: string | null;
  /** OAuth client of the calling service. */
  requestedBy: string;
}

export function icmsReferralSubmitted(
  data: IcmsReferralSubmittedData,
): NewEvent<IcmsReferralSubmittedData> {
  return {
    type: ICMS_REFERRAL_SUBMITTED,
    subject: data.referralReference,
    tenant: PLATFORM_TENANT,
    data,
  };
}

/**
 * The gateway sent ICMS a referral it did not answer (ADR-008: an integration call, answered or
 * not, is audited): ICMS down, timed out, its breaker open or paused, or holding another referral
 * under the reference. Nothing is recorded as registered. Once per attempt; the same identifiers
 * as `icms.referral.submitted.v1`, with why.
 */
export const ICMS_REFERRAL_UNACKNOWLEDGED = 'icms.referral.unacknowledged.v1';

export interface IcmsReferralUnacknowledgedData extends Record<string, unknown> {
  referralReference: string;
  referringCommission: string;
  /** An unavailable reason, or `reference-conflict`: ICMS holds another referral under it. */
  reason: UnavailableReason | 'reference-conflict';
  legalBasis: InstructionLegalBasis;
  caseRef: string | null;
  /** OAuth client of the calling service. */
  requestedBy: string;
}

export function icmsReferralUnacknowledged(
  data: IcmsReferralUnacknowledgedData,
): NewEvent<IcmsReferralUnacknowledgedData> {
  return {
    type: ICMS_REFERRAL_UNACKNOWLEDGED,
    subject: data.referralReference,
    tenant: PLATFORM_TENANT,
    data,
  };
}
