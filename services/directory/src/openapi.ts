import { principalSchema } from '@adili/api-kit';
import type { z } from 'zod';

import { assignReportingOfficerBody } from './commissions/assign-reporting-officer.js';
import {
  commissionTypeSchema,
  createCommissionBody,
  officerCategoryCodeSchema,
  slugSchema,
} from './commissions/create-commission.js';
import {
  commissionPageSchema,
  commissionSchema,
  officerCategorySchema,
  reportingOfficerSchema,
  reportingOfficerStateSchema,
  rosterSummarySchema,
} from './commissions/representation.js';

/**
 * Named schemas of the directory's OpenAPI document (`#/components/schemas/<name>`), which is
 * exported to packages/schemas/internal/directory.yaml by `pnpm contracts`.
 */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  Principal: principalSchema,
  Slug: slugSchema,
  CommissionType: commissionTypeSchema,
  OfficerCategoryCode: officerCategoryCodeSchema,
  OfficerCategory: officerCategorySchema,
  CreateCommission: createCommissionBody,
  AssignReportingOfficer: assignReportingOfficerBody,
  ReportingOfficerState: reportingOfficerStateSchema,
  ReportingOfficer: reportingOfficerSchema,
  RosterSummary: rosterSummarySchema,
  Commission: commissionSchema,
  CommissionPage: commissionPageSchema,
};
