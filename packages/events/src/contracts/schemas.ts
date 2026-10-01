/**
 * `@adili/events/contracts/schemas`: Zod schemas of the event data consumers validate, one per
 * contract so producer and consumers agree. Apart from `@adili/events/contracts` because they
 * pull in Zod, which the browser bundles that use the contracts' plain values must not carry.
 */
import { z } from 'zod';

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

/** `verification.checked.v1` data, as its consumers validate it. */
export const verificationCheckedDataSchema = z.object({
  verificationId: verificationIdSchema,
  outcome: z.enum(VERIFICATION_OUTCOMES),
}) satisfies z.ZodType<VerificationCheckedData>;
