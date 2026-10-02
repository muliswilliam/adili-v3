import { z } from 'zod';

import { ICMS_STATUSES } from '../db/schema.js';
import { NATIONAL_ID } from '../registries/registry-records.js';

// The internal API (packages/schemas/internal/integration-gateway.yaml), within ICMS's own limits
// (external/icms.yaml `ReferralRequest`), so ICMS never refuses what we accept.

/** An `RFL` reference: ICMS keeps up to 40 characters. */
export const REFERRAL_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/;
/** A Commission's issuer code, e.g. `PSC`: ICMS keeps up to 20 characters. */
const ISSUER_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/;
/** The referral's narrative as reporting cuts it (`ICMS_DETAILS_MAX`). */
const DETAILS_MAX = 8_000;

export const icmsStatusSchema = z.enum(ICMS_STATUSES);

export const referralReferenceSchema = z
  .string()
  .regex(REFERRAL_REFERENCE, 'must be a referral reference of at most 40 characters');

/**
 * A referral to register with ICMS (`IcmsReferralRequest`). Personal data (national ID, full
 * name): it travels to ICMS in the body, never in a URL; only the national ID is kept, as a keyed
 * hash.
 */
export const icmsReferralRequestSchema = z
  .strictObject({
    referralReference: referralReferenceSchema.meta({ description: 'The RFL reference' }),
    nationalId: z.string().regex(NATIONAL_ID, 'must be 5 to 10 digits'),
    fullName: z.string().trim().min(1).max(200),
    referringCommission: z
      .string()
      .regex(ISSUER_CODE, 'must be an issuer code')
      .meta({ description: "The referring Commission's issuer code, e.g. PSC" }),
    grounds: z.string().trim().min(1).max(200),
    details: z.string().max(DETAILS_MAX),
  })
  .meta({ description: 'A referral to register with ICMS' });
export type IcmsReferralRequest = z.infer<typeof icmsReferralRequestSchema>;

/** The referral as ICMS registered it (`IcmsReferral`). */
export const icmsReferralSchema = z
  .object({
    referralReference: z.string(),
    caseNumber: z.string().meta({ description: "ICMS's case number, e.g. EACC/ICMS/2028/000123" }),
    status: icmsStatusSchema,
    registeredAt: z.iso
      .datetime({ offset: true })
      .meta({ description: "When ICMS registered it, by ICMS's clock" }),
    sentAt: z.iso
      .datetime({ offset: true })
      .meta({ description: 'When the gateway sent the referral ICMS answered' }),
  })
  .meta({ description: 'A referral and its ICMS registration' });
export type IcmsReferral = z.infer<typeof icmsReferralSchema>;

// ICMS's own shapes (packages/schemas/external/icms.yaml).

/**
 * external/icms.yaml `Referral`, the answer of `submitReferral` (201 registered, 200 a
 * resubmission of the same reference answering the original).
 */
export const icmsRegistrationSchema = z
  .object({
    case_number: z.string().min(1),
    referral_reference: z.string().min(1),
    id_number: z.string(),
    referring_commission: z.string(),
    status: icmsStatusSchema,
    registered_at: z.iso.datetime({ offset: true }),
  })
  .transform((registration) => ({
    caseNumber: registration.case_number,
    referralReference: registration.referral_reference,
    nationalId: registration.id_number,
    referringCommission: registration.referring_commission,
    status: registration.status,
    registeredAt: registration.registered_at,
  }));
export type IcmsRegistration = z.output<typeof icmsRegistrationSchema>;
