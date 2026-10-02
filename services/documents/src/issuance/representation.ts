import {
  ACKNOWLEDGEMENT_SLIP,
  CLARIFICATION_LETTER,
  DISCLOSURE_LEVELS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
} from '@adili/events/contracts';
import { z } from 'zod';

import { acknowledgementSlipPayload } from './templates/acknowledgement-slip.v1.js';

/**
 * Request and response shapes of the issuance API, mirroring
 * packages/schemas/internal/documents.yaml (tests validate responses against it).
 */

export const documentTypeSchema = z.enum(DOCUMENT_TYPES).meta({
  description: 'Document types with a template; later specs add theirs',
});
export const disclosureLevelSchema = z.enum(DISCLOSURE_LEVELS).meta({
  description:
    "What the public verify page shows: public (content), restricted (reference, type, Commission, date), confidential (validity only). Fixed by the document type's template",
});
export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);

const issueDocumentFields = {
  templateVersion: z.int().min(1),
  subjectRef: z
    .string()
    .regex(/^[a-z][a-z-]*:[0-9a-f-]{36}$/)
    .meta({
      description:
        'The record the document is about; one document per type and subject. Issuing again returns it',
      examples: ['declaration-version:0192f0c4-8a51-7cc2-9d1e-3b3f2a7e4c10'],
    }),
  subjectPersonId: z.uuid().nullable().meta({
    description: 'The person who may download the document (the declarant); null for none',
  }),
};

/** An acknowledgement slip: its caller sends the fields the template renders, never stored. */
export const issueAcknowledgementSlipBody = z.object({
  type: z.literal(ACKNOWLEDGEMENT_SLIP),
  ...issueDocumentFields,
  payload: acknowledgementSlipPayload,
});

/**
 * The clarification a letter is for: the documents service pulls the fields the template renders
 * from the review service (`internalGetClarificationLetterPayload`, acting for the same tenant),
 * so no personal data travels in the request.
 */
export const clarificationLetterSource = z.object({ clarificationId: z.uuid() }).meta({
  description:
    "The clarification whose letter this is; the fields the template renders are pulled from the review service's letter payload endpoint",
});

/** A clarification letter of the review service (spec 07a), its fields pulled. */
export const issueClarificationLetterBody = z.object({
  type: z.literal(CLARIFICATION_LETTER),
  ...issueDocumentFields,
  payload: clarificationLetterSource,
});

/**
 * One request shape per document type; the service checks the fields against the template of
 * `type` and `templateVersion`.
 */
export const issueDocumentBody = z.discriminatedUnion('type', [
  issueAcknowledgementSlipBody,
  issueClarificationLetterBody,
]);
export type IssueDocumentBody = z.infer<typeof issueDocumentBody>;

export const supersedeDocumentBody = z.object({
  supersededBy: z.uuid().meta({ description: 'The newer document of the same type and tenant' }),
});
export type SupersedeDocumentBody = z.infer<typeof supersedeDocumentBody>;

export const issuedDocumentSchema = z.object({
  id: z.uuid(),
  type: documentTypeSchema,
  templateVersion: z.int(),
  disclosureLevel: disclosureLevelSchema,
  issuerTenant: z.string(),
  subjectRef: z.string(),
  verificationId: z.string().meta({
    description: 'Printed under the QR code',
    examples: ['ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-9KMV-8P'],
  }),
  verifyUrl: z.url().meta({ description: "The QR code's payload: the document's verify page" }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: documentStatusSchema,
  supersededBy: z.uuid().nullable(),
  issuedAt: z.iso.datetime(),
});
export type IssuedDocument = z.infer<typeof issuedDocumentSchema>;

export const documentDownloadSchema = z.object({
  downloadUrl: z.url().meta({ description: 'Presigned GET of the signed PDF' }),
  expiresAt: z.iso.datetime(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type DocumentDownload = z.infer<typeof documentDownloadSchema>;
