import type { z } from 'zod';

import {
  approvalItemSchema,
  approvalKindSchema,
  approvalReassignmentSchema,
} from './approvals/approvals.service.js';
import { assigneeSchema } from './cases/assignee.js';
import { versionComparisonSchema } from './cases/comparison.js';
import {
  caseDetailSchema,
  caseListItemSchema,
  caseStatusSchema,
  declarationTypeSchema,
  flagSchema,
  noteSchema,
  priorityBandSchema,
  queueSummarySchema,
  reviewerListSchema,
  registryCheckSchema,
  registryCheckStatusSchema,
  registrySummarySchema,
  registrySystemSchema,
  ruleIdSchema,
  severitySchema,
  timelineEntrySchema,
} from './cases/representation.js';
import {
  clarificationCountsRequest,
  clarificationCountsSchema,
  clarificationDisclosureRequest,
  clarificationDisclosureSchema,
  disclosedClarificationItemSchema,
  disclosedClarificationSchema,
} from './clarifications/disclosure.js';
import {
  clarificationInput,
  clarificationItemInput,
  responseInput,
} from './clarifications/clarification-input.js';
import {
  clarificationDetailsSchema,
  clarificationLetterPayloadSchema,
  clarificationSchema,
  clarificationStatusSchema,
  declarantClarificationSchema,
  letterLanguageSchema,
  requirementSchema,
} from './clarifications/representation.js';
import {
  bulkApprovalResultSchema,
  closureSummarySchema,
} from './closures/bulk-closures.service.js';
import { commissionAiStatusSchema } from './copilot/ai-status.controller.js';
import { copilotDraftSchema } from './copilot/copilot-drafts.service.js';
import { copilotBlockSchema, copilotFeedbackInput } from './copilot/copilot-feedback.js';
import { copilotStatusSchema, copilotViewSchema } from './copilot/copilot.service.js';
import { copilotDraftInput } from './copilot/draft-input.js';
import {
  determinationInput,
  furtherActionLink,
  reasonInput,
} from './determinations/determination-input.js';
import {
  declarantDecisionSchema,
  determinationLetterPayloadSchema,
  determinationOutcomeSchema,
  determinationSchema,
  letterDownloadSchema,
  proposalStatusSchema,
  proposerKindSchema,
} from './determinations/representation.js';
import {
  actionLetterPayloadSchema,
  actionStatusSchema,
  actionStepSchema,
  administrativeActionSchema,
  declarantNoticeSchema,
  ladderSchema,
  payrollAckSchema,
} from './enforcement/representation.js';
import { referralInput } from './referrals/referral-input.js';
import {
  manifestItemSchema,
  manifestKindSchema,
  referralGroundsSchema,
  referralIcmsPayloadSchema,
  referralPackagePayloadSchema,
  referralSchema,
  referralStatusSchema,
} from './referrals/representation.js';
import { registryStatusSchema, registryViewSchema } from './registry/representation.js';

/**
 * Named schemas of the review service's OpenAPI document (`#/components/schemas/<name>`), which
 * is exported to packages/schemas/internal/review.yaml by `pnpm contracts`.
 */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  DeclarationType: declarationTypeSchema,
  CaseStatus: caseStatusSchema,
  PriorityBand: priorityBandSchema,
  Severity: severitySchema,
  RuleId: ruleIdSchema,
  ClarificationStatus: clarificationStatusSchema,
  Requirement: requirementSchema,
  Assignee: assigneeSchema,
  CaseListItem: caseListItemSchema,
  QueueSummary: queueSummarySchema,
  ReviewerList: reviewerListSchema,
  CopilotStatus: copilotStatusSchema,
  CopilotView: copilotViewSchema,
  CopilotDraftInput: copilotDraftInput,
  CopilotDraft: copilotDraftSchema,
  CommissionAiStatus: commissionAiStatusSchema,
  CopilotBlock: copilotBlockSchema,
  CopilotFeedbackInput: copilotFeedbackInput,
  Flag: flagSchema,
  Note: noteSchema,
  TimelineEntry: timelineEntrySchema,
  CaseDetail: caseDetailSchema,
  VersionComparison: versionComparisonSchema,
  ClarificationItemInput: clarificationItemInput,
  LetterLanguage: letterLanguageSchema,
  ClarificationInput: clarificationInput,
  ClarificationResponseInput: responseInput,
  Clarification: clarificationSchema,
  DeclarantClarification: declarantClarificationSchema,
  InternalClarificationDetails: clarificationDetailsSchema,
  ClarificationLetterPayload: clarificationLetterPayloadSchema,
  ClarificationDisclosureRequest: clarificationDisclosureRequest,
  ClarificationDisclosure: clarificationDisclosureSchema,
  DisclosedClarification: disclosedClarificationSchema,
  DisclosedClarificationItem: disclosedClarificationItemSchema,
  ClarificationCountsRequest: clarificationCountsRequest,
  ClarificationCounts: clarificationCountsSchema,
  RegistrySystem: registrySystemSchema,
  RegistryCheckStatus: registryCheckStatusSchema,
  RegistryCheck: registryCheckSchema,
  RegistrySummary: registrySummarySchema,
  RegistryView: registryViewSchema,
  RegistryStatus: registryStatusSchema,
  DeterminationOutcome: determinationOutcomeSchema,
  ProposalStatus: proposalStatusSchema,
  ProposerKind: proposerKindSchema,
  ReasonInput: reasonInput,
  DeterminationInput: determinationInput,
  FurtherActionLink: furtherActionLink,
  Determination: determinationSchema,
  LetterDownload: letterDownloadSchema,
  ApprovalKind: approvalKindSchema,
  ApprovalItem: approvalItemSchema,
  ClosureSummary: closureSummarySchema,
  BulkApprovalResult: bulkApprovalResultSchema,
  ActionStep: actionStepSchema,
  ActionStatus: actionStatusSchema,
  PayrollAck: payrollAckSchema,
  AdministrativeAction: administrativeActionSchema,
  Ladder: ladderSchema,
  ReferralGrounds: referralGroundsSchema,
  ReferralStatus: referralStatusSchema,
  ReferralInput: referralInput,
  Referral: referralSchema,
  ReferralManifestKind: manifestKindSchema,
  ReferralManifestItem: manifestItemSchema,
  ReferralIcmsPayload: referralIcmsPayloadSchema,
  ReferralPackagePayload: referralPackagePayloadSchema,
  ApprovalReassignment: approvalReassignmentSchema,
  DeterminationLetterPayload: determinationLetterPayloadSchema,
  ActionLetterPayload: actionLetterPayloadSchema,
  DeclarantDecision: declarantDecisionSchema,
  DeclarantNotice: declarantNoticeSchema,
};
