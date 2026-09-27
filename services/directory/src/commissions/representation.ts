import { z } from 'zod';

import {
  commissionTypeSchema,
  officerCategoryCodeSchema,
  slugSchema,
} from './create-commission.js';

/**
 * Response shapes of the Commissions API. They are the contract: the OpenAPI document
 * (packages/schemas/internal/directory.yaml) is generated from these schemas, and the types
 * the service returns are inferred from them.
 */

export type CommissionType = z.infer<typeof commissionTypeSchema>;

export const reportingOfficerStateSchema = z.enum(['invited', 'activated', 'replaced']).meta({
  description:
    "`invited` once assigned; `activated` when the officer's account first makes an authenticated request to the directory (in practice the console's `/v1/me` after their first sign-in); `replaced` when another officer takes over.",
});
export type ReportingOfficerState = z.infer<typeof reportingOfficerStateSchema>;

export const officerCategorySchema = z.object({
  code: officerCategoryCodeSchema,
  citation: z.string().meta({ examples: ['Act s.32(10)'] }),
  description: z.string().meta({ examples: ['Registered teachers'] }),
});
export type OfficerCategory = z.infer<typeof officerCategorySchema>;

export const reportingOfficerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  phone: z.string(),
  state: reportingOfficerStateSchema,
  invitedAt: z.iso.datetime(),
  activatedAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: "First authenticated request of the officer's account; null until then" }),
});
export type ReportingOfficer = z.infer<typeof reportingOfficerSchema>;

export const rosterSummarySchema = z.object({
  status: z.enum(['none', 'imported']),
  expectedDeclarants: z.number().int(),
  onboardedDeclarants: z.number().int(),
  flagged: z.number().int(),
  lastImportAt: z.iso.datetime().nullable(),
  lastImportId: z.uuid().nullable(),
});
export type RosterSummary = z.infer<typeof rosterSummarySchema>;

export const commissionSchema = z.object({
  id: z.uuid(),
  slug: slugSchema,
  issuerCode: z.string().meta({ description: 'slug upper-cased', examples: ['TSC'] }),
  name: z.string(),
  type: commissionTypeSchema,
  categories: z.array(officerCategorySchema),
  status: z.enum(['active']),
  policyVersion: z
    .number()
    .int()
    .meta({ description: 'Current policy version; 1 after provisioning' }),
  reportingOfficer: reportingOfficerSchema
    .nullable()
    .meta({ description: 'Current assignment (`invited` or `activated`); null when none' }),
  roster: rosterSummarySchema,
  createdAt: z.iso.datetime(),
});
export type Commission = z.infer<typeof commissionSchema>;

export const commissionPageSchema = z.object({
  items: z.array(commissionSchema),
  nextCursor: z
    .string()
    .nullable()
    .meta({ description: 'Pass as `cursor` for the next page; null on the last page' }),
  total: z
    .number()
    .int()
    .meta({ description: 'Commissions matching the filters across all pages' }),
});
export type CommissionPage = z.infer<typeof commissionPageSchema>;

/** Roster summary until slice 02 imports rosters. */
export const NO_ROSTER: RosterSummary = {
  status: 'none',
  expectedDeclarants: 0,
  onboardedDeclarants: 0,
  flagged: 0,
  lastImportAt: null,
  lastImportId: null,
};
