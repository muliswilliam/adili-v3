/* Generated from @adili/schemas/forms/form-m.v1.json by scripts/generate-types.ts. Do not edit. */

import { z } from 'zod';

export const ACTIONS_TAKEN = [
  'none',
  'notice-to-comply',
  'warning',
  'salary-stoppage',
  'disciplinary-referral',
  'referred-to-eacc',
] as const;

export const COMPLIANCE_STATUSES = ['yes', 'no', 'pending'] as const;

export const FORM_M_VERSION = 'form-m.v1';

export const CLARIFICATION_STATUSES = [
  'responded',
  'resolved',
  'pending',
  'overdue',
  'withdrawn',
] as const;

export const DECLINE_REASONS = [
  'public-interest',
  'prejudice-proceeding',
  'frivolous-vexatious',
  'not-objectives',
  'other',
] as const;

export const REPORT_SOURCES = ['hosted', 'federated'] as const;

export const SignatorySchema = z.strictObject({
  name: z.string().max(200).nullable(),
  designation: z.string().max(100).nullable(),
  date: z.iso.date().nullable(),
});

export const NonFilerRowSchema = z.strictObject({
  name: z.string(),
  designation: z.string(),
  identifier: z.string(),
  date: z.iso.date(),
  actionTaken: z.enum(ACTIONS_TAKEN),
  complied: z.enum(COMPLIANCE_STATUSES),
  remarks: z.string().max(500).optional(),
  obligationId: z.guid().optional(),
});

/** Sections 1-3: counts and the list of officers who did not declare */
export const DeclarationSectionSchema = z.strictObject({
  expected: z.int().min(0),
  declared: z.int().min(0),
  notDeclared: z.int().min(0),
  nonFilers: z.array(NonFilerRowSchema),
  noCycleInPeriod: z.boolean().optional(),
});

/** One compliance report per Responsible Commission per financial year (1 July to 30 June), mirroring the prescribed Form M: Part I description, Part II declarations (sections 1-5) and complaints (sections 6-7), Part III authentication. Draft: spec 09. */
export const FormMSchema = z.strictObject({
  schemaVersion: z.literal(FORM_M_VERSION),
  partI: z.strictObject({
    commissionName: z.string().min(1).max(200),
    issuerCode: z.string().regex(/^[A-Z0-9]{2,20}$/u),
    contactDetails: z.string().max(200),
    physicalAddress: z.string().max(200),
    emailAddress: z.email(),
    period: z.strictObject({
      from: z.iso.date(),
      to: z.iso.date(),
      financialYearStart: z.int().min(2025),
    }),
  }),
  partII: z.strictObject({
    initial: DeclarationSectionSchema,
    biennial: z.intersection(
      DeclarationSectionSchema,
      z.strictObject({
        noCycleInPeriod: z.boolean().optional(),
      }),
    ),
    final: DeclarationSectionSchema,
    clarifications: z.strictObject({
      items: z.array(
        z.strictObject({
          name: z.string(),
          designation: z.string(),
          identifier: z.string(),
          natureInGeneralTerms: z.string().max(300),
          statusOfCompliance: z.enum(CLARIFICATION_STATUSES),
          clarificationReference: z.string().optional(),
        }),
      ),
    }),
    accessRequests: z.strictObject({
      received: z.int().min(0),
      granted: z.int().min(0),
      declined: z.int().min(0),
      declineReasons: z.array(
        z.strictObject({
          reason: z.enum(DECLINE_REASONS),
          count: z.int().min(0),
        }),
      ),
      dataUnavailable: z.boolean(),
    }),
    complaints: z.strictObject({
      registerMaintained: z.boolean().nullable(),
      items: z.array(
        z.strictObject({
          name: z.string(),
          designation: z.string(),
          identifier: z.string(),
          nature: z.string().max(300),
          status: z.string().max(100),
        }),
      ),
    }),
  }),
  partIII: z.strictObject({
    compiledBy: SignatorySchema,
    confirmedBy: SignatorySchema,
  }),
  meta: z
    .strictObject({
      compiledAt: z.iso.datetime({ offset: true }).optional(),
      reference: z.string().optional(),
      source: z.enum(REPORT_SOURCES).optional(),
    })
    .optional(),
});
