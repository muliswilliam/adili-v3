import { FormMSchema } from '@adili/forms';
import type { z } from 'zod';

import {
  aiTaskRatingsSchema,
  aiUsageCommissionSchema,
  aiUsageReportSchema,
} from './ai-usage/ai-usage.service.js';
import { intakeSchema, intakeStatusSchema } from './compliance-reports/intake.js';
import {
  complianceReportSchema,
  complianceReportSummarySchema,
  formMDocumentSchema,
  reportCountsSchema,
  reportSourceSchema,
  reportStatusSchema,
  submittedComplianceReportSchema,
} from './compliance-reports/representation.js';
import { confirmBody, manualFieldsBody } from './compliance-reports/sign-off-input.js';
import { patternCandidateSchema } from './national-reports/candidates.js';
import { narrativeSchema, paragraphSchema } from './national-reports/narrative.js';
import {
  nationalAggregatesSchema,
  narrativeDraftSchema,
  nationalReportSchema,
} from './national-reports/representation.js';
import { officerSchema } from './officer.js';
import { commissionOpenDataPreviewSchema } from './open-data/commission-preview.service.js';
import { publicOpenDataReleaseSchema } from './open-data/public-representation.js';
import {
  openDataReleaseDetailSchema,
  openDataReleaseSchema,
  openDataTableFileSchema,
  openDataTableNameSchema,
} from './open-data/representation.js';
import {
  icmsPushErrorSchema,
  icmsStatusSchema,
  referralGroundsSchema,
  referralIntakeItemSchema,
  referralIntakePageSchema,
} from './referrals/representation.js';

/**
 * Named schemas of the reporting service's OpenAPI document (`#/components/schemas/<name>`),
 * exported with the controllers' operations to packages/schemas/internal/reporting.yaml.
 */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  Officer: officerSchema,
  ReportStatus: reportStatusSchema,
  ReportSource: reportSourceSchema,
  ReportCounts: reportCountsSchema,
  FormMDocument: formMDocumentSchema,
  ComplianceReportSummary: complianceReportSummarySchema,
  ComplianceReport: complianceReportSchema,
  SubmittedComplianceReport: submittedComplianceReportSchema,
  // form-m.v1 (packages/schemas/forms/form-m.v1.json). Its parts stay unnamed: naming the
  // declaration section would export biennial's intersection as an allOf of two closed objects,
  // which no document satisfies.
  FormM: FormMSchema,
  ManualFields: manualFieldsBody,
  ConfirmReport: confirmBody,
  IntakeStatus: intakeStatusSchema,
  Intake: intakeSchema,
  Narrative: narrativeSchema,
  NarrativeParagraph: paragraphSchema,
  NationalAggregates: nationalAggregatesSchema,
  PatternCandidate: patternCandidateSchema,
  NarrativeDraft: narrativeDraftSchema,
  NationalReport: nationalReportSchema,
  ReferralGrounds: referralGroundsSchema,
  IcmsStatus: icmsStatusSchema,
  IcmsPushError: icmsPushErrorSchema,
  ReferralIntakeItem: referralIntakeItemSchema,
  ReferralIntakePage: referralIntakePageSchema,
  AiUsageReport: aiUsageReportSchema,
  AiUsageCommission: aiUsageCommissionSchema,
  AiTaskRatings: aiTaskRatingsSchema,
  OpenDataTable: openDataTableNameSchema,
  OpenDataRelease: openDataReleaseSchema,
  OpenDataTableFile: openDataTableFileSchema,
  OpenDataReleaseDetail: openDataReleaseDetailSchema,
  CommissionOpenDataPreview: commissionOpenDataPreviewSchema,
  PublicOpenDataRelease: publicOpenDataReleaseSchema,
};
