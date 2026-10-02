import { COMMISSION_ADMIN, REPORTING_OFFICER, SUPERVISOR } from '@adili/roles';
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
  status: z.enum(['none', 'imported']).meta({
    description: '`imported` once an import of the roster has completed',
  }),
  expectedDeclarants: z.number().int().meta({ description: 'Roster records not exited' }),
  onboardedDeclarants: z.number().int(),
  flagged: z.number().int().meta({
    description: 'Records not exited flagged as absent from the latest complete import',
  }),
  lastImportAt: z.iso.datetime().nullable().meta({
    description: 'When the latest completed import (complete or partial) finished',
  }),
  lastImportId: z.uuid().nullable(),
  lastCompleteImportAt: z.iso.datetime().nullable().meta({
    description: 'When the latest completed import declared as the complete roster finished',
  }),
});
export type RosterSummary = z.infer<typeof rosterSummarySchema>;

/** What services show a Commission by (internal): e.g. declarations' obligations per Commission. */
export const internalCommissionSchema = z.object({
  slug: slugSchema,
  issuerCode: z.string().meta({ description: 'slug upper-cased', examples: ['TSC'] }),
  name: z.string(),
});
export type InternalCommission = z.infer<typeof internalCommissionSchema>;

/** Every Commission on the platform (internal), for services keeping a read model of them. */
export const internalCommissionListSchema = z.object({
  items: z.array(internalCommissionSchema),
});
export type InternalCommissionList = z.infer<typeof internalCommissionListSchema>;

/** The roles services list a Commission's staff by (spec 09 reminders and chase). */
export const STAFF_ROLES = [REPORTING_OFFICER, SUPERVISOR, COMMISSION_ADMIN] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const staffQuery = z.object({ role: z.enum(STAFF_ROLES) });
export type StaffQuery = z.infer<typeof staffQuery>;

/** A Commission's staff holding a role, with the email a service reaches them at (internal). */
export const internalCommissionStaffSchema = z.object({
  items: z.array(
    z.object({
      subject: z.string().meta({ description: "The staff member's account (token `sub`)" }),
      email: z.email(),
    }),
  ),
});
export type InternalCommissionStaff = z.infer<typeof internalCommissionStaffSchema>;

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
