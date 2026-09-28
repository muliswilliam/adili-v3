import type { z } from 'zod';

import {
  cancelReasonSchema,
  commissionRefSchema,
  commissionSummarySchema,
  myObligationsSchema,
  nationalSummarySchema,
  obligationDetailSchema,
  obligationListItemSchema,
  obligationPageSchema,
  obligationSchema,
  obligationStatusSchema,
  obligationTypeSchema,
  officerRefSchema,
  reminderChannelSchema,
  reminderOutcomeSchema,
  reminderSchema,
  statusCountsSchema,
  summaryCycleSchema,
} from './obligations/representation.js';

/**
 * Named schemas of the declarations service's OpenAPI document (`#/components/schemas/<name>`),
 * which is exported to packages/schemas/internal/declarations.yaml by `pnpm contracts`.
 */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  ObligationType: obligationTypeSchema,
  ObligationStatus: obligationStatusSchema,
  CancelReason: cancelReasonSchema,
  ReminderOutcome: reminderOutcomeSchema,
  ReminderChannel: reminderChannelSchema,
  CommissionRef: commissionRefSchema,
  Obligation: obligationSchema,
  Reminder: reminderSchema,
  OfficerRef: officerRefSchema,
  ObligationDetail: obligationDetailSchema,
  MyObligations: myObligationsSchema,
  ObligationListItem: obligationListItemSchema,
  ObligationPage: obligationPageSchema,
  StatusCounts: statusCountsSchema,
  SummaryCycle: summaryCycleSchema,
  CommissionSummary: commissionSummarySchema,
  NationalSummary: nationalSummarySchema,
};
