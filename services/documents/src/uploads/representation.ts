import { z } from 'zod';

import { uploadPurposeSchema } from './purposes.js';
import { UPLOAD_REJECTIONS, UPLOAD_STATES } from './schema.js';

/**
 * Request and response shapes of the uploads API, mirroring
 * packages/schemas/internal/documents.yaml (tests validate responses against it).
 */

export const uploadStateSchema = z.enum(UPLOAD_STATES);
export const uploadRejectionSchema = z.enum(UPLOAD_REJECTIONS).meta({
  description:
    'Why a rejected upload was refused: `type` the bytes are not the declared type; `encoding` a CSV that is not UTF-8 text (save it as CSV UTF-8); `size` over the limit or not the declared size; `missing` nothing was uploaded; `timeout` the checks did not finish',
});

export const createUploadBody = z.object({
  purpose: uploadPurposeSchema,
  contentType: z
    .string()
    .min(1)
    .max(255)
    .meta({
      description: "One of the purpose's types; the PUT to uploadUrl must send it as Content-Type",
      examples: ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    }),
  declaredSize: z.number().int().min(1).meta({
    description: "Bytes; within the purpose's limit. The PUT must send exactly this many bytes",
  }),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional()
    .meta({ description: 'Display only; never used as an object key' }),
});
export type CreateUploadBody = z.infer<typeof createUploadBody>;

export const uploadReservationSchema = z.object({
  id: z.uuid(),
  uploadUrl: z.url().meta({
    description:
      'Presigned PUT; send the raw bytes with the declared Content-Type and size before expiresAt',
  }),
  expiresAt: z.iso.datetime(),
  maxSize: z.number().int(),
});
export type UploadReservation = z.infer<typeof uploadReservationSchema>;

export const uploadSchema = z.object({
  id: z.uuid(),
  purpose: uploadPurposeSchema,
  state: uploadStateSchema,
  rejection: uploadRejectionSchema.nullable(),
  contentType: z
    .string()
    .meta({ description: 'Declared type; detectedType is set after completion' }),
  detectedType: z.string().nullable(),
  declaredSize: z.number().int(),
  size: z.number().int().nullable(),
  sha256: z.string().nullable().meta({ description: 'Hex digest, set when clean' }),
  fileName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type Upload = z.infer<typeof uploadSchema>;

/** An upload as the owning service sees it: who uploaded it and whether it is linked. */
export const internalUploadSchema = uploadSchema.extend({
  uploadedBy: z.string().meta({
    description: 'Token subject (`sub`) of the caller who reserved the upload',
  }),
  linkedAt: z.iso.datetime().nullable().meta({
    description: 'When the owning service linked it to its record; null while unlinked',
  }),
});
export type InternalUpload = z.infer<typeof internalUploadSchema>;

export const uploadDownloadSchema = z.object({
  id: z.uuid(),
  purpose: uploadPurposeSchema,
  state: z.literal('clean'),
  downloadUrl: z.url(),
  expiresAt: z.iso.datetime(),
  sha256: z.string(),
  size: z.number().int(),
  fileName: z.string().nullable().meta({ description: 'As given at createUpload; display only' }),
  detectedType: z
    .string()
    .meta({ description: 'Sniffed content type, e.g. text/csv or the XLSX type' }),
});
export type UploadDownload = z.infer<typeof uploadDownloadSchema>;
