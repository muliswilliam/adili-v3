import { type ProblemCode, problemDetailsSchema } from '@adili/api-kit';
import { z } from 'zod';

import { IDENTITY_DOCUMENT_KINDS, IDENTITY_STATUSES } from '../../persons/schema.js';
import {
  EMAIL_MAX_LENGTH,
  normaliseEmail,
  normaliseNationalId,
  normalisePhone,
} from '../../roster/normalise.js';
import { APPLICANT_STATES, SET_PASSWORD_EMAIL_STATUSES } from '../session-state.js';

/** Representations of applicant onboarding (spec 10; contract components of the same names). */

export const identityDocumentKindSchema = z.enum(IDENTITY_DOCUMENT_KINDS);

export const identityStatusSchema = z.enum(IDENTITY_STATUSES).meta({
  description:
    '`verified`: by IPRS at onboarding (national ID) or by an access officer (passport). `pending-verification`: a passport applicant whose first Form K is held until an access officer verifies the particulars entered',
});

/** A name as typed: trimmed, letters (any script), marks, spaces, apostrophes, dots and hyphens. */
const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(100)
  .regex(/^\p{L}[\p{L}\p{M}' .-]*$/u, 'Use letters, spaces, apostrophes and hyphens only');

const NATIONAL_ID = /^\d{5,10}$/;
const PASSPORT_NUMBER = /^[A-Z0-9]{5,20}$/;
const COUNTRY = /^[A-Z]{2}$/;

/**
 * Body of `POST /v1/onboarding/applicants` (`StartApplicantOnboarding`), normalised: national ID
 * digits without spaces, passport number upper-cased without spaces, names trimmed, email
 * lower-cased, phone in E.164 (Kenya the default country). The email is required: the account's
 * username, and where its set-password link goes.
 */
export const startApplicantOnboardingBody = z
  .object({
    identityDocument: z.object({
      kind: identityDocumentKindSchema,
      number: z.string().max(30).meta({
        description:
          'A national ID: 5 to 10 digits. A passport: 5 to 20 letters and digits, compared upper-cased. Spaces are ignored',
      }),
      country: z
        .string()
        .optional()
        .meta({
          description:
            "A passport's issuing country, ISO 3166-1 alpha-2 (e.g. `UG`); required for a passport, not sent for a national ID",
          examples: ['UG'],
        }),
    }),
    names: z.object({
      surname: nameSchema,
      firstName: nameSchema,
      otherNames: nameSchema.optional(),
    }),
    phone: z.string().max(30).meta({
      description: 'E.164, or a Kenyan number such as 0712345678; its code is sent at once',
    }),
    email: z.string().max(EMAIL_MAX_LENGTH).meta({
      description:
        'The account username; the set-password email goes here when onboarding completes',
    }),
  })
  .transform((body, context) => {
    const { kind } = body.identityDocument;
    const compact = body.identityDocument.number.replace(/\s+/g, '');
    const number = kind === 'national-id' ? normaliseNationalId(compact) : compact.toUpperCase();
    if (!(kind === 'national-id' ? NATIONAL_ID : PASSPORT_NUMBER).test(number)) {
      context.addIssue({
        code: 'custom',
        path: ['identityDocument', 'number'],
        message:
          kind === 'national-id'
            ? 'Enter 5 to 10 digits'
            : 'Enter the passport number: 5 to 20 letters and digits',
      });
    }
    const country = body.identityDocument.country?.trim().toUpperCase();
    if (kind === 'passport' && (country === undefined || !COUNTRY.test(country))) {
      context.addIssue({
        code: 'custom',
        path: ['identityDocument', 'country'],
        message: 'Choose the country that issued the passport',
      });
    }
    if (kind === 'national-id' && country !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['identityDocument', 'country'],
        message: 'Only a passport has an issuing country',
      });
    }
    const phone = normalisePhone(body.phone);
    if (phone === null) {
      context.addIssue({
        code: 'custom',
        path: ['phone'],
        message: 'Enter a valid phone number, e.g. 0712345678 or +254712345678',
      });
    }
    const email = normaliseEmail(body.email);
    if (email === null) {
      context.addIssue({ code: 'custom', path: ['email'], message: 'Enter a valid email address' });
    }
    if (phone === null || email === null) return z.NEVER;
    return {
      identityDocument: {
        kind,
        number,
        country: kind === 'passport' ? (country ?? null) : null,
      },
      names: {
        surname: body.names.surname,
        firstName: body.names.firstName,
        otherNames: body.names.otherNames ?? null,
      },
      phone,
      email,
    };
  });

export type StartApplicantOnboardingBody = z.output<typeof startApplicantOnboardingBody>;

export const applicantOnboardingStateSchema = z.enum(APPLICANT_STATES);

export const applicantOnboardingSessionSchema = z.object({
  id: z.uuid(),
  state: applicantOnboardingStateSchema,
  fullName: z.string().meta({
    description:
      'The names entered at start, first and other names then surname, as the account will have them',
  }),
  identityDocument: z
    .object({
      kind: identityDocumentKindSchema,
      number: z.string().meta({
        description: 'As entered at start, normalised (national ID digits, passport upper-cased)',
      }),
      country: z.string().nullable().meta({
        description: "A passport's issuing country (ISO 3166-1 alpha-2); null for a national ID",
      }),
    })
    .meta({
      description:
        'The document entered at start, so the applicant can check it before the account is created; only the holder of the session secret sees it',
    }),
  identityStatus: identityStatusSchema.meta({
    description:
      'The identity status the account gets: `verified` for a national ID IPRS matched at start, `pending-verification` for a passport',
  }),
  contacts: z.object({
    phone: z
      .object({
        masked: z.string().meta({ description: 'e.g. 07** *** 123' }),
        verified: z.boolean(),
      })
      .nullable(),
    email: z
      .object({ masked: z.string().meta({ description: 'e.g. j***@example.com' }) })
      .nullable(),
  }),
  otp: z
    .object({
      channel: z.literal('phone').nullable(),
      resendAvailableAt: z.iso.datetime().nullable(),
      resendsLeft: z.number().int(),
      attemptsLeft: z.number().int(),
    })
    .meta({
      description:
        'The phone code while `phone-pending`; once confirmed, `resendAvailableAt` is when the set-password email may be sent again (null: now)',
    }),
  outcome: z
    .literal('account-created')
    .nullable()
    .meta({ description: 'Set once confirmed: the account was created' }),
  setPasswordEmail: z.enum(SET_PASSWORD_EMAIL_STATUSES).nullable().meta({
    description:
      'Once confirmed: `sent`, the set-password email went; `failed`, the account stands but the email could not be sent, so the portal offers resend-password-email at once. Null before',
  }),
  expiresAt: z.iso.datetime().meta({
    description:
      'When the session ends: 30 minutes after start, 10 more per successful step, at most 60 minutes after start. Once confirmed, 24 hours after (the set-password link lifespan)',
  }),
});

export type ApplicantOnboardingSession = z.infer<typeof applicantOnboardingSessionSchema>;

export const applicantOnboardingSessionCreatedSchema = applicantOnboardingSessionSchema.extend({
  secret: z.string().meta({
    description:
      'Returned once; the BFF stores it in an httpOnly cookie and sends it back in X-Onboarding-Secret',
  }),
});

export type ApplicantOnboardingSessionCreated = z.infer<
  typeof applicantOnboardingSessionCreatedSchema
>;

/** The problem codes applicant onboarding routes send. */
export const APPLICANT_ONBOARDING_PROBLEM_CODES = [
  'identity-mismatch',
  'already-onboarded',
  'otp-invalid',
  'otp-expired',
  'otp-send-failed',
  'resend-cooldown',
  'session-expired',
  'iprs-unavailable',
  'identity-unavailable',
  'email-in-use',
  'rate-limit-exceeded',
  'wrong-step',
] as const satisfies readonly ProblemCode[];

export const applicantOnboardingProblemSchema = problemDetailsSchema.extend({
  code: z.enum(APPLICANT_ONBOARDING_PROBLEM_CODES),
  attemptsLeft: z.number().int().optional(),
  retryAfterSeconds: z.number().int().optional(),
  links: z
    .object({ signIn: z.url().optional(), recoverAccess: z.url().optional() })
    .optional()
    .meta({ description: 'Present for already-onboarded' }),
});
