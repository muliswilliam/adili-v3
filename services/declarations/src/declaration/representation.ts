import { z } from 'zod';

import { declarationReferenceSchema } from './reference.js';
import { ACKNOWLEDGEMENT_STATUS_VALUES } from './schema.js';

/**
 * Bodies of a submitted version and its acknowledgement slip (spec 06), shown by the drafts'
 * list, the submission and the versions routes alike. They are the contract: the OpenAPI
 * document, packages/schemas/internal/declarations.yaml, is generated from them (`pnpm contracts`).
 */

/** A version's acknowledgement slip as the declarant sees it (see `acknowledgementStatus`). */
export const acknowledgementStatusSchema = z.enum(ACKNOWLEDGEMENT_STATUS_VALUES);

export const acknowledgementSchema = z.object({
  status: acknowledgementStatusSchema.meta({
    description:
      '`pending` until the documents service has issued the slip, `failed` when issuance gave up',
  }),
  documentId: z.uuid().nullable().meta({ description: 'The issued slip; null until issued' }),
  verificationId: z
    .string()
    .nullable()
    .meta({ description: 'Verification code printed under the QR; null until issued' }),
  verifyUrl: z.url().nullable().meta({
    description:
      "Where the verify page answers for the slip, the QR code's payload (`<verify origin>/v/<code>`); null until issued",
  }),
  issuedAt: z.iso.datetime().nullable(),
  verifiedCount: z.int().meta({ description: 'Lookups of the slip on the verify app' }),
  downloadUrl: z.url().nullable().meta({
    description:
      "Null: the slip downloads from the documents service (`getDocumentDownload` with `documentId`), the owner's short-lived link, audited there",
  }),
});
export type Acknowledgement = z.infer<typeof acknowledgementSchema>;

export const declarationVersionSchema = z.object({
  version: z.int().min(1),
  reference: declarationReferenceSchema,
  submittedAt: z.iso.datetime(),
  late: z.boolean().meta({ description: "Submitted after the obligation's due date" }),
  canonicalSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .meta({ description: "Hex SHA-256 of the document's RFC 8785 canonical JSON" }),
  supersededAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: 'When a later version replaced it; null while in force' }),
  acknowledgement: acknowledgementSchema,
});
export type DeclarationVersion = z.infer<typeof declarationVersionSchema>;

export const declarationVersionDetailSchema = declarationVersionSchema.extend({
  document: z.record(z.string(), z.unknown()).meta({
    description:
      'The immutable declaration.v1 document as submitted (decrypted for the declarant), its attestation carrying the reference and the time it was declared',
  }),
});
export type DeclarationVersionDetail = z.infer<typeof declarationVersionDetailSchema>;
