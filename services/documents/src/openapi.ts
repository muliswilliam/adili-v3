import type { z } from 'zod';

import {
  clarificationLetterSource,
  disclosureLevelSchema,
  documentDownloadSchema,
  documentStatusSchema,
  documentTypeSchema,
  issueAcknowledgementSlipBody,
  issueClarificationLetterBody,
  issueDocumentBody,
  issuedDocumentSchema,
  supersedeDocumentBody,
} from './issuance/representation.js';
import { acknowledgementSlipPayload } from './issuance/templates/acknowledgement-slip.v1.js';
import { uploadPurposeSchema } from './uploads/purposes.js';
import {
  createUploadBody,
  internalUploadSchema,
  uploadDownloadSchema,
  uploadRejectionSchema,
  uploadReservationSchema,
  uploadSchema,
  uploadStateSchema,
} from './uploads/representation.js';

/** Named schemas of the documents service's OpenAPI document (`#/components/schemas/<name>`). */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  UploadPurpose: uploadPurposeSchema,
  UploadState: uploadStateSchema,
  UploadRejection: uploadRejectionSchema,
  CreateUpload: createUploadBody,
  UploadReservation: uploadReservationSchema,
  Upload: uploadSchema,
  UploadDownload: uploadDownloadSchema,
  DocumentType: documentTypeSchema,
  DisclosureLevel: disclosureLevelSchema,
  DocumentStatus: documentStatusSchema,
  IssueDocument: issueDocumentBody,
  IssueAcknowledgementSlip: issueAcknowledgementSlipBody,
  IssueClarificationLetter: issueClarificationLetterBody,
  ClarificationLetterSource: clarificationLetterSource,
  SupersedeDocument: supersedeDocumentBody,
  IssuedDocument: issuedDocumentSchema,
  DocumentDownload: documentDownloadSchema,
  AcknowledgementSlipPayload: acknowledgementSlipPayload,
  InternalUpload: internalUploadSchema,
};
