import type { NewEvent } from '@adili/events';

/**
 * Events about persons. Ids only: never a document number, name or contact (ADR-013 §3).
 */

export const APPLICANT_IDENTITY_VERIFIED = 'applicant.identity-verified.v1';

export interface ApplicantIdentityVerifiedData extends Record<string, unknown> {
  personId: string;
  /** Subject of the access officer who checked the particulars entered. */
  verifiedBy: string;
}

/**
 * An access officer verified a passport applicant's particulars (spec 10): the applicant's
 * identity status is now `verified`. `tenant` is the Commission the officer acted for.
 */
export function applicantIdentityVerified(
  tenant: string,
  data: ApplicantIdentityVerifiedData,
): NewEvent<ApplicantIdentityVerifiedData> {
  return { type: APPLICANT_IDENTITY_VERIFIED, subject: data.personId, tenant, data };
}
