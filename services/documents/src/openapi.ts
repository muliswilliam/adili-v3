import type { z } from 'zod';

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
  InternalUpload: internalUploadSchema,
};
