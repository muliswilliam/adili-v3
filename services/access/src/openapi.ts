import type { z } from 'zod';

import {
  decisionInputSchema,
  decisionSchema,
  groundSchema,
  outcomeSchema,
  packageSchema,
} from './decision.js';
import { declarantNoticeSchema, representationsInputSchema } from './notices/representation.js';
import { registerEntrySchema } from './register/representation.js';
import { verifyApplicantBody } from './requests/applicant-verification.service.js';
import {
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
  DecisionInput: decisionInputSchema,
  Package: packageSchema,
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
  RepresentationsInput: representationsInputSchema,
  DeclarantNotice: declarantNoticeSchema,
};
