import { hasValidCheckCharacter } from '@adili/numbering';
import { z } from 'zod';

import { slugSchema } from '../commissions/create-commission.js';
import { ofrSchema } from '../onboarding/representation.js';
import { rosterRecordStateSchema } from '../roster/records/representation.js';
import { IDENTITY_DOCUMENT_KINDS, IDENTITY_STATUSES, PREFERRED_LANGUAGES } from './schema.js';

/** Representations of a person (a declarant) to themself and to the helpdesk. */

export const preferredLanguageSchema = z.enum(PREFERRED_LANGUAGES).meta({
  description:
    "A declarant's preferred language, English or Kiswahili: a clarification letter to them starts in it",
});

export const declarantProfileSchema = z.object({
  personId: z.uuid(),
  ofr: ofrSchema,
  fullName: z.string().meta({ description: 'As confirmed at onboarding' }),
  contacts: z
    .object({
      email: z.string().nullable(),
      phone: z.string().nullable().meta({ description: 'E.164' }),
    })
    .meta({ description: 'The contacts verified at the latest onboarding' }),
  preferredLanguage: preferredLanguageSchema
    .nullable()
    .meta({ description: 'As the declarant chose it in the portal; null until they choose one' }),
  commissions: z
    .array(
      z.object({
        slug: slugSchema,
        name: z.string(),
        personnelFileNumber: z.string(),
        rosterRecordId: z.uuid(),
        state: rosterRecordStateSchema,
        onboardedAt: z.iso.datetime().nullable(),
      }),
    )
    .meta({ description: "The person's roster records, one per Commission, ordered by name" }),
});
export type DeclarantProfile = z.infer<typeof declarantProfileSchema>;

/** Body of `PUT /v1/me/declarant/preferred-language`. */
export const setPreferredLanguageBody = z.object({ preferredLanguage: preferredLanguageSchema });
export type SetPreferredLanguageBody = z.infer<typeof setPreferredLanguageBody>;

/** A declarant's preferred language as a service reads it (the review service, spec 07c FE-3). */
export const personPreferredLanguageSchema = z.object({
  personId: z.uuid(),
  preferredLanguage: preferredLanguageSchema
    .nullable()
    .meta({ description: 'Null until the declarant chooses one' }),
});
export type PersonPreferredLanguage = z.infer<typeof personPreferredLanguageSchema>;

export const personSummarySchema = z.object({
  personId: z.uuid(),
  ofr: ofrSchema,
  fullName: z.string(),
  commissions: z
    .array(slugSchema)
    .meta({ description: 'Commissions whose roster records the person is linked to' }),
  contactsOnFile: z.object({ email: z.boolean(), phone: z.boolean() }).meta({
    description:
      'Whether a verified email and phone are on file, so the helpdesk knows where a recovery code can go; never the contacts themselves',
  }),
  createdAt: z.iso.datetime().meta({ description: 'When the account was created' }),
});
export type PersonSummary = z.infer<typeof personSummarySchema>;

/** Query of `GET /v1/persons`. */
export const findPersonQuery = z.object({
  ofr: ofrSchema.refine(hasValidCheckCharacter, {
    message: 'Not an officer reference: the check character does not match',
    // Only a well-shaped reference has a check character to verify.
    when: (payload) => payload.issues.length === 0,
  }),
});
export type FindPersonQuery = z.infer<typeof findPersonQuery>;

/** The contacts notifications sends a person's messages to (spec 04; applicants', spec 10). */
export const personContactsSchema = z.object({
  personId: z.uuid(),
  email: z.string().nullable().meta({
    description:
      "Verified at onboarding (an applicant's: as entered, proved by the set-password link); null when none",
  }),
  phone: z
    .string()
    .nullable()
    .meta({ description: 'E.164, verified at onboarding; null when none' }),
});
export type PersonContacts = z.infer<typeof personContactsSchema>;

/** The national ID a person was onboarded with, for their own registry lookups (spec 05b). */
export const personNationalIdSchema = z.object({
  nationalId: z.string().meta({ description: 'Digits only, as verified at onboarding' }),
});
export type PersonNationalId = z.infer<typeof personNationalIdSchema>;
/** An applicant's identity document as entered at onboarding (spec 10). */
export const applicantIdentityDocumentSchema = z.object({
  kind: z.enum(IDENTITY_DOCUMENT_KINDS),
  number: z.string().meta({
    description: 'National ID digits, or the passport number upper-cased without spaces',
  }),
  country: z.string().nullable().meta({
    description: "A passport's issuing country, ISO 3166-1 alpha-2; null for a national ID",
  }),
});

/** The signed-in applicant's own particulars, which pre-fill Part I of Form K (spec 10). */
export const applicantProfileSchema = z.object({
  personId: z.uuid(),
  fullName: z.string().meta({ description: 'First, other and surname as entered' }),
  identityDocument: applicantIdentityDocumentSchema,
  identityStatus: z.enum(IDENTITY_STATUSES),
  contacts: z.object({
    email: z.string().nullable(),
    phone: z.string().nullable().meta({ description: 'E.164, verified at onboarding' }),
  }),
});
export type ApplicantProfile = z.infer<typeof applicantProfileSchema>;

/** An applicant as the access service reads them (spec 10). */
export const internalApplicantSchema = applicantProfileSchema.extend({
  identityVerifiedAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: 'When the identity became verified; null while pending' }),
  identityVerifiedBy: z.string().nullable().meta({
    description:
      "Subject of the access officer who verified a passport applicant's particulars; null when IPRS verified a national ID, or while pending",
  }),
});
export type InternalApplicant = z.infer<typeof internalApplicantSchema>;

/** Body of `POST /internal/v1/applicants/{personId}/identity-verification`. */
export const verifyApplicantIdentityBody = z.object({
  verifiedBy: z.string().min(1).max(255).meta({
    description: 'Subject (`sub`) of the access officer who checked the particulars entered',
  }),
});
export type VerifyApplicantIdentityBody = z.infer<typeof verifyApplicantIdentityBody>;
