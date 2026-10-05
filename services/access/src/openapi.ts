import type { z } from 'zod';

import { accessCommissionSchema } from './commissions/representation.js';
import {
  decisionInputSchema,
  decisionSchema,
  leaDecisionSchema,
  groundSchema,
  outcomeSchema,
  packageSchema,
  publicDecisionSchema,
} from './decision.js';
import { accessHistoryEntrySchema, historyCertifiedCopySchema } from './history/representation.js';
import {
  leaProvenanceSchema,
  leaRequestInputSchema,
  leaRequestSchema,
  leaRequestStatusSchema,
  leaVerificationSchema,
  verifyLeaRequestBody,
} from './lea/representation.js';
import {
  declarantNoticeSchema,
  formKDeclarantNoticeSchema,
  representationsInputSchema,
} from './notices/representation.js';
import { scopePreviewSchema, scopePreviewYearSchema } from './preview/representation.js';
import { registerEntrySchema } from './register/representation.js';
import { verifyApplicantBody } from './requests/applicant-verification.service.js';
import {
  attachmentDownloadSchema,
  queueItemSchema,
  queuePageSchema,
  resolveOfficerBody,
  rosterCandidateSchema,
  rosterCandidatesSchema,
} from './requests/officer-representation.js';
import { officerRequestViewSchema, representationsSchema } from './requests/officer-view.js';
import {
  accessRequestSchema,
  accessRequestStatusSchema,
  formKSchema,
} from './requests/representation.js';
import { scopeSchema, sectionSchema } from './scope.js';
import { noticeSchema, writtenNoticeBody } from './written-notice.js';
import {
  declarantVersionSchema,
  declarantVersionsSchema,
  selfAccessApplicationDetailSchema,
  selfAccessApplicationInputSchema,
  selfAccessApplicationSchema,
  selfAccessPageSchema,
} from './self-access/application-representation.js';
import { certifiedCopyRequestSchema, certifiedCopySchema } from './self-access/representation.js';

/**
 * Named schemas of the access service's OpenAPI document (`#/components/schemas/<name>`). The
 * operations and schemas not implemented yet stay in packages/schemas/drafts/access.yaml, which
 * may reference these.
 */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  AccessRequestStatus: accessRequestStatusSchema,
  Outcome: outcomeSchema,
  Ground: groundSchema,
  Section: sectionSchema,
  Scope: scopeSchema,
  Decision: decisionSchema,
  PublicDecision: publicDecisionSchema,
  LeaDecision: leaDecisionSchema,
  DecisionInput: decisionInputSchema,
  Package: packageSchema,
  ScopePreview: scopePreviewSchema,
  ScopePreviewYear: scopePreviewYearSchema,
  FormK: formKSchema,
  AccessRequest: accessRequestSchema,
  RegisterEntry: registerEntrySchema,
  Representations: representationsSchema,
  OfficerRequestView: officerRequestViewSchema,
  VerifyApplicantIdentity: verifyApplicantBody,
  QueueItem: queueItemSchema,
  QueuePage: queuePageSchema,
  ResolveOfficer: resolveOfficerBody,
  RosterCandidate: rosterCandidateSchema,
  RosterCandidates: rosterCandidatesSchema,
  AttachmentDownload: attachmentDownloadSchema,
  RepresentationsInput: representationsInputSchema,
  FormKDeclarantNotice: formKDeclarantNoticeSchema,
  WrittenNotice: writtenNoticeBody,
  Notice: noticeSchema,
  DeclarantNotice: declarantNoticeSchema,
  AccessCommission: accessCommissionSchema,
  AccessHistoryEntry: accessHistoryEntrySchema,
  HistoryCertifiedCopy: historyCertifiedCopySchema,
  CertifiedCopyRequest: certifiedCopyRequestSchema,
  CertifiedCopy: certifiedCopySchema,
  LeaRequestStatus: leaRequestStatusSchema,
  LeaRequestInput: leaRequestInputSchema,
  LeaProvenance: leaProvenanceSchema,
  LeaVerification: leaVerificationSchema,
  VerifyLeaRequest: verifyLeaRequestBody,
  LeaRequest: leaRequestSchema,
  DeclarantVersion: declarantVersionSchema,
  DeclarantVersions: declarantVersionsSchema,
  SelfAccessApplicationInput: selfAccessApplicationInputSchema,
  SelfAccessApplication: selfAccessApplicationSchema,
  SelfAccessApplicationDetail: selfAccessApplicationDetailSchema,
  SelfAccessPage: selfAccessPageSchema,
};
