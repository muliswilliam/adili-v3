import { problemDetailsSchema } from '@adili/api-kit';
import { z } from 'zod';

import { slugSchema } from '../commissions/create-commission.js';
import { CONTACT_SOURCES } from '../roster/schema.js';
import { ONBOARDING_OUTCOMES, ONBOARDING_STATES, OTP_CHANNELS } from './session-state.js';

/** Representations of the public onboarding API (contract components of the same names). */

export const ofrSchema = z
  .string()
  .regex(/^OFR-[0-9]{7}-[0-9A-Z]$/)
  .meta({
    description: 'Officer reference (ADR-011), permanent and person-level',
    examples: ['OFR-0482913-L'],
  });

export const otpChannelSchema = z.enum(OTP_CHANNELS);

export const onboardingStateSchema = z.enum(ONBOARDING_STATES);

export const onboardingOutcomeSchema = z.enum(ONBOARDING_OUTCOMES);

export const onboardingCommissionSchema = z.object({
  slug: slugSchema,
  issuerCode: z.string().meta({ description: 'slug upper-cased', examples: ['TSC'] }),
  name: z.string(),
  hasRoster: z
    .boolean()
    .meta({ description: 'Whether the Commission has imported a roster; identify needs one' }),
});

export type OnboardingCommission = z.infer<typeof onboardingCommissionSchema>;

/** Query of `GET /v1/onboarding/commissions`. */
export const listOnboardingCommissionsQuery = z.object({
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value === '' ? undefined : value))
    .meta({
      description:
        'Part of the name, or the issuer code, case-insensitive; blank means every Commission',
    }),
});

export type ListOnboardingCommissionsQuery = z.infer<typeof listOnboardingCommissionsQuery>;

/** Body of `POST /v1/onboarding/sessions` (`IdentifyDeclarant`). */
export const identifyDeclarantBody = z.object({
  commission: slugSchema,
  personnelFileNumber: z.string().min(1).max(30).meta({
    description: 'As on the payslip; compared trimmed and case-insensitively',
  }),
  nationalId: z
    .string()
    .regex(/^[0-9 ]{5,12}$/)
    .refine((value) => /^\d{5,10}$/.test(value.replace(/ /g, '')), 'Enter 5 to 10 digits')
    .meta({ description: 'Digits after stripping spaces, 5 to 10' }),
});

export type IdentifyDeclarantBody = z.infer<typeof identifyDeclarantBody>;

export const maskedContactSchema = z.object({
  masked: z.string().meta({ description: 'e.g. j***@moe.go.ke or 07** *** 123' }),
  source: z.enum(CONTACT_SOURCES),
  verified: z.boolean(),
});

export type MaskedContact = z.infer<typeof maskedContactSchema>;

export const onboardingSessionSchema = z.object({
  id: z.uuid(),
  state: onboardingStateSchema,
  commission: onboardingCommissionSchema,
  contacts: z.object({
    email: maskedContactSchema.nullable(),
    phone: maskedContactSchema.nullable(),
  }),
  details: z
    .object({
      fullName: z.string(),
      personnelFileNumber: z.string(),
      designation: z.string().nullable(),
      reportingEntity: z.string().nullable(),
    })
    .nullable()
    .meta({ description: 'Roster details shown at the confirm step; null before phone-verified' }),
  otp: z
    .object({
      channel: otpChannelSchema.nullable(),
      resendAvailableAt: z.iso.datetime().nullable(),
      resendsLeft: z.number().int(),
      attemptsLeft: z.number().int(),
    })
    .meta({ description: 'Resend availability for the channel currently pending' }),
  outcome: onboardingOutcomeSchema
    .nullable()
    .optional()
    .meta({ description: 'Set when state is confirmed or identity-mismatch' }),
  ofr: ofrSchema.nullable().optional(),
  expiresAt: z.iso.datetime(),
});

export type OnboardingSession = z.infer<typeof onboardingSessionSchema>;

export const onboardingSessionCreatedSchema = onboardingSessionSchema.extend({
  secret: z.string().meta({
    description:
      'Returned once; the BFF stores it in an httpOnly cookie and sends it back in X-Onboarding-Secret',
  }),
});

export type OnboardingSessionCreated = z.infer<typeof onboardingSessionCreatedSchema>;

/** The problem codes onboarding routes send. */
export const ONBOARDING_PROBLEM_CODES = [
  'no-match',
  'already-onboarded',
  'no-roster',
  'otp-invalid',
  'otp-expired',
  'resend-cooldown',
  'session-expired',
  'iprs-unavailable',
  'identity-unavailable',
  'rate-limit-exceeded',
] as const;

export const onboardingProblemSchema = problemDetailsSchema.extend({
  code: z.enum(ONBOARDING_PROBLEM_CODES),
  attemptsLeft: z.number().int().optional(),
  retryAfterSeconds: z.number().int().optional(),
  links: z
    .object({ signIn: z.url().optional(), recoverAccess: z.url().optional() })
    .optional()
    .meta({ description: 'Present for already-onboarded' }),
});
