/**
 * `@adili/events/contracts/schemas`: Zod schemas of the event data consumers validate, one per
 * contract so producer and consumers agree. Apart from `@adili/events/contracts` because they
 * pull in Zod, which the browser bundles that use the contracts' plain values must not carry.
 */
import { z } from 'zod';

import {
  ACCESS_GROUNDS,
  ACCESS_LEGAL_BASES,
  ACCESS_OUTCOMES,
  ACCESS_REGISTER_KINDS,
  ACCESS_SUBJECT_KINDS,
  type AccessCertifiedCopyIssuedData,
  type AccessRegisterEventData,
  type AccessRequestCannotIdentifyData,
  type AccessRequestIdentifiedData,
  type AccessRequestDecidedData,
  type AccessRequestReceivedData,
  CANNOT_IDENTIFY_DECLINE_REASON,
} from './access.js';
import {
  DISCLOSURE_LEVELS,
  DOCUMENT_STATUSES,
  REVOCATION_REASONS,
  VERIFICATION_ID_PATTERN,
} from './documents.js';
import { VERIFICATION_OUTCOMES, type VerificationCheckedData } from './verification.js';

/** A verification id in its printed form, as events carry it. */
export const verificationIdSchema = z.string().regex(VERIFICATION_ID_PATTERN);

const timestamp = z.iso.datetime({ offset: true });

/**
 * `DocumentEventData` as its consumers validate it, one schema for every consumer: each picks
 * the fields it reads (`.pick`) and may narrow one it relies on more (`.extend`). The public
 * payload is left open here; the verify page's projection keeps only the fields it shows.
 */
export const documentEventDataSchema = z.object({
  documentId: z.uuid(),
  verificationId: verificationIdSchema,
  documentType: z.string().min(1),
  templateVersion: z.int().positive(),
  disclosureLevel: z.enum(DISCLOSURE_LEVELS),
  issuerTenant: z.string().min(1),
  subjectRef: z.string().min(1),
  publicPayload: z.record(z.string(), z.unknown()).nullable(),
  verifyUrl: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  issuedAt: timestamp,
  status: z.enum(DOCUMENT_STATUSES),
});

/** `document.issued.v1` data. */
export const documentIssuedDataSchema = documentEventDataSchema;

/** `document.superseded.v1` data. */
export const documentSupersededDataSchema = documentEventDataSchema.extend({
  supersededBy: z.uuid(),
  supersededByVerificationId: verificationIdSchema,
  statusChangedAt: timestamp,
});

/** `document.revoked.v1` data. */
export const documentRevokedDataSchema = documentEventDataSchema.extend({
  reasonCategory: z.enum(REVOCATION_REASONS),
  statusChangedAt: timestamp,
});

/** `document.downloaded.v1` data. */
export const documentDownloadedDataSchema = z.object({
  documentId: z.uuid(),
  verificationId: verificationIdSchema,
  documentType: z.string().min(1),
  issuerTenant: z.string().min(1),
  subjectRef: z.string().min(1),
  downloadedBy: z.string().min(1),
  downloadedAt: timestamp,
  downloadExpiresAt: timestamp.nullable(),
});

/** `verification.checked.v1` data, as its consumers validate it. */
export const verificationCheckedDataSchema = z.object({
  verificationId: verificationIdSchema,
  outcome: z.enum(VERIFICATION_OUTCOMES),
}) satisfies z.ZodType<VerificationCheckedData>;

/**
 * `AccessRegisterEventData` as its consumers validate it: the data of every access event (one per
 * access-register entry). Open, as each kind adds its own facts.
 */
export const accessRegisterEventDataSchema = z.looseObject({
  registerEntryId: z.uuid(),
  subjectKind: z.enum(ACCESS_SUBJECT_KINDS),
  subjectId: z.uuid(),
  reference: z.string().min(1).nullable(),
  tenant: z.string().min(1),
  kind: z.enum(ACCESS_REGISTER_KINDS),
  legalBasis: z.enum(ACCESS_LEGAL_BASES),
  personId: z.uuid().nullable(),
  actor: z.string().min(1).nullable(),
  at: timestamp,
}) satisfies z.ZodType<AccessRegisterEventData>;

/**
 * `access.request.received.v1` / `lea.request.received.v1` data: Form M section 5 counts a request
 * received from it.
 */
export const accessRequestReceivedDataSchema = accessRegisterEventDataSchema.extend({
  kind: z.literal('received'),
  decisionDeadlineAt: timestamp,
}) satisfies z.ZodType<AccessRequestReceivedData>;

/**
 * `access.request.decided.v1` / `lea.request.decided.v1` data: Form M section 5 counts a grant
 * (full or partial) or a decline, with the Regulation 24 grounds (none for a full grant).
 */
export const accessRequestDecidedDataSchema = accessRegisterEventDataSchema.extend({
  kind: z.literal('decided'),
  outcome: z.enum(ACCESS_OUTCOMES),
  grounds: z.array(z.enum(ACCESS_GROUNDS)),
}) satisfies z.ZodType<AccessRequestDecidedData>;

/** `access.request.identified.v1` data: who identified the declarant, and as which record. */
export const accessRequestIdentifiedDataSchema = accessRegisterEventDataSchema.extend({
  kind: z.literal('identified'),
  rosterRecordId: z.uuid(),
}) satisfies z.ZodType<AccessRequestIdentifiedData>;

/**
 * `access.request.cannot-identify.v1` data: Form M section 5 counts the request declined for
 * reason `other`.
 */
export const accessRequestCannotIdentifyDataSchema = accessRegisterEventDataSchema.extend({
  kind: z.literal('cannot-identify'),
  declineReason: z.literal(CANNOT_IDENTIFY_DECLINE_REASON),
}) satisfies z.ZodType<AccessRequestCannotIdentifyData>;

/** `access.certified-copy.issued.v1` data. */
export const accessCertifiedCopyIssuedDataSchema = accessRegisterEventDataSchema.extend({
  subjectKind: z.literal('self-access'),
  kind: z.literal('self-access'),
  declarationId: z.uuid(),
  version: z.int().positive(),
  documentId: z.uuid(),
  applicationId: z.uuid().nullable(),
}) satisfies z.ZodType<AccessCertifiedCopyIssuedData>;
