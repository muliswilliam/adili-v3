import {
  DISCLOSURE_LEVELS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  REVOCATION_REASONS,
} from '@adili/events/contracts';
import { z } from 'zod';

import {
  actionLetterSource,
  clarificationLetterSource,
  decisionLetterSource,
  referralPackageSource,
} from './pulled-payloads.js';
import { sha256Schema } from './sha256.js';
import { accessNilLetterPayload } from './templates/access-nil-letter.v1.js';
import { accessPackagePayload } from './templates/access-package.v1.js';
import { acknowledgementSlipPayload } from './templates/acknowledgement-slip.v1.js';
import { certifiedCopyPayload } from './templates/certified-copy.v1.js';
import { complianceReportReceiptPayload } from './templates/compliance-report-receipt.v1.js';
import { formMPayload } from './templates/form-m.v1.js';
import { ncrPayload } from './templates/ncr.v1.js';
import { openDataManifestPayload } from './templates/open-data-manifest.v1.js';

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

/** The longest download window issuance accepts. */
export const MAX_DOWNLOAD_WINDOW_DAYS = 90;

export const watermarkSchema = z
  .strictObject({
    recipientName: z.string().trim().min(1).max(200),
    reference: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .meta({ examples: ['ARQ-PSC-2026-0000012-H'] }),
    date: z.iso.date(),
  })
  .meta({
    description:
      'Printed across every page as `Issued to <recipientName> · <reference> · <date>` (ADR-010 §6), so a leaked copy traces to its recipient. Required for access-package and access-nil-letter',
  });

/**
 * Strict, so a caller sending a field the service does not read (a disclosure level, an issuer or
 * a public payload, which the template and X-Acting-Tenant decide) is refused, not ignored.
 */
export const issueDocumentBody = z.strictObject({
  type: documentTypeSchema,
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
    description:
      'The only person who may download the document: the declarant, the applicant or the law-enforcement officer (their token carries it as `person_id`); null for none. Required for access-package, access-nil-letter and certified-copy; for a letter of the review service, the person its record names (none for an officer who never onboarded); null for a referral-package, a form-m, a compliance-report-receipt, an ncr and an open-data-manifest',
  }),
  watermark: watermarkSchema.optional(),
  downloadWindowDays: z.int().min(1).max(MAX_DOWNLOAD_WINDOW_DAYS).optional().meta({
    description:
      'Days from issue during which the subject person may download the document; afterwards a download is refused with 410 `download-window-closed`. None: no window. Required for access-package and access-nil-letter',
  }),
  additionalDownloaders: z
    .array(z.string().trim().min(1).max(255))
    .max(10)
    .refine((subjects) => new Set(subjects).size === subjects.length, 'Subjects must be distinct')
    .optional()
    .meta({
      description:
        "Token subjects (`sub`) of the issuing Commission's staff who may download the document besides its subject person, with a token of that Commission, within the same window and audited the same way: the access officer who recorded an in-person self-access application, to print the certified copy they hand over. None: the subject person only",
    }),
  /**
   * The fields the template renders, never stored beyond the PDF. One schema per template; the
   * service checks the payload against the template of `type` and `templateVersion`. A letter
   * of the review service, or a referral package, names its record instead, and its fields are
   * pulled (pulled-payloads.ts).
   */
  payload: z
    .union([
      acknowledgementSlipPayload,
      clarificationLetterSource,
      decisionLetterSource,
      actionLetterSource,
      referralPackageSource,
      accessPackagePayload,
      accessNilLetterPayload,
      certifiedCopyPayload,
      formMPayload,
      complianceReportReceiptPayload,
      ncrPayload,
      openDataManifestPayload,
    ])
    .meta({
      description:
        "The template's payload: the schema named after `type`, or for a pulled type the record it is pulled for (`clarificationId`, `determinationId`, `actionId` or `referralId`)",
    }),
});
export type IssueDocumentBody = z.infer<typeof issueDocumentBody>;

/**
 * `issueDocumentBody` as the route validates it: the service checks the payload against the
 * template of `type` and `templateVersion`, so its errors name the template's fields.
 */
export const issueDocumentRequest = issueDocumentBody.extend({ payload: z.unknown() });
export type IssueDocumentRequest = z.infer<typeof issueDocumentRequest>;

export const supersedeDocumentBody = z.object({
  supersededBy: z.uuid().meta({ description: 'The newer document of the same type and tenant' }),
});
export type SupersedeDocumentBody = z.infer<typeof supersedeDocumentBody>;

export const revocationReasonSchema = z.enum(REVOCATION_REASONS).meta({
  description:
    'Why the document is revoked, a category the verify page may show: issued-in-error (e.g. a clarification letter withdrawn as issued in error, spec 07a), withdrawn or other',
});

export const revokeDocumentBody = z.object({ reason: revocationReasonSchema });
export type RevokeDocumentBody = z.infer<typeof revokeDocumentBody>;

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
  sha256: sha256Schema,
  status: documentStatusSchema,
  supersededBy: z.uuid().nullable(),
  issuedAt: z.iso.datetime(),
  downloadExpiresAt: z.iso.datetime().nullable().meta({
    description: 'End of the download window; null when the document has none',
  }),
});
export type IssuedDocument = z.infer<typeof issuedDocumentSchema>;

export const documentDownloadSchema = z.object({
  downloadUrl: z.url().meta({ description: 'Presigned GET of the signed PDF' }),
  expiresAt: z.iso.datetime(),
  sha256: sha256Schema,
});
export type DocumentDownload = z.infer<typeof documentDownloadSchema>;
