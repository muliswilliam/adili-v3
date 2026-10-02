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
  requirementSchema,
} from './clarifications/representation.js';
import {
  bulkApprovalResultSchema,
  closureSummarySchema,
} from './closures/bulk-closures.service.js';
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
 * is exported to packages/schemas/internal/review.yaml by `pnpm contracts`. The copilot's (spec
 * 07c) are drafted in packages/schemas/drafts/review.yaml until implemented.
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
  Flag: flagSchema,
  Note: noteSchema,
  TimelineEntry: timelineEntrySchema,
  CaseDetail: caseDetailSchema,
  VersionComparison: versionComparisonSchema,
  ClarificationItemInput: clarificationItemInput,
  ClarificationInput: clarificationInput,
  ClarificationResponseInput: responseInput,
  Clarification: clarificationSchema,
  DeclarantClarification: declarantClarificationSchema,
  InternalClarificationDetails: clarificationDetailsSchema,
  ClarificationLetterPayload: clarificationLetterPayloadSchema,
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
