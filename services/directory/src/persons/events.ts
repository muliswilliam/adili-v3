import { PLATFORM_TENANT } from '@adili/api-kit';
import type { NewEvent } from '@adili/events';

import type { PreferredLanguage } from './schema.js';

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

export const PERSON_PREFERRED_LANGUAGE_SET = 'person.preferred-language-set.v1';

export interface PersonPreferredLanguageSetData extends Record<string, unknown> {
  personId: string;
  preferredLanguage: PreferredLanguage;
}

/**
 * A declarant chose the language a clarification letter to them starts in (spec 07c FE-3): the
 * write's audit record (ADR-008). Persons are platform-level, so it is recorded for the platform.
 */
export function personPreferredLanguageSet(
  data: PersonPreferredLanguageSetData,
): NewEvent<PersonPreferredLanguageSetData> {
  return {
    type: PERSON_PREFERRED_LANGUAGE_SET,
    subject: data.personId,
    tenant: PLATFORM_TENANT,
    data,
  };
}
