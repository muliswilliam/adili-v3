import type { z } from 'zod';

import {
  completenessIssueSchema,
  completenessSchema,
  declarationSchema,
  declarationStatusSchema,
  sectionContentsSchema,
  sectionEnvelopeSchema,
  sectionKeySchema,
  sectionSaveResultSchema,
} from './drafts/representation.js';
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
  declarantRefSchema,
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
  DeclarantRef: declarantRefSchema,
  ObligationDetail: obligationDetailSchema,
  MyObligations: myObligationsSchema,
  ObligationListItem: obligationListItemSchema,
  ObligationPage: obligationPageSchema,
  StatusCounts: statusCountsSchema,
  SummaryCycle: summaryCycleSchema,
  CommissionSummary: commissionSummarySchema,
  NationalSummary: nationalSummarySchema,
  SectionKey: sectionKeySchema,
  Completeness: completenessSchema,
  DeclarationStatus: declarationStatusSchema,
  Declaration: declarationSchema,
  SectionContents: sectionContentsSchema,
  CompletenessIssue: completenessIssueSchema,
  SectionEnvelope: sectionEnvelopeSchema,
  SectionSaveResult: sectionSaveResultSchema,
};
