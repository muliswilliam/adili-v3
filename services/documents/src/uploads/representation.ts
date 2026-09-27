import { z } from 'zod';

import { uploadPurposeSchema } from './purposes.js';
import { UPLOAD_REJECTIONS, UPLOAD_STATES } from './schema.js';

/**
 * Request and response shapes of the uploads API, mirroring
 * packages/schemas/internal/documents.yaml (tests validate responses against it).
 */

export const uploadStateSchema = z.enum(UPLOAD_STATES);
export const uploadRejectionSchema = z.enum(UPLOAD_REJECTIONS);

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

export const uploadDownloadSchema = z.object({
  id: z.uuid(),
  purpose: uploadPurposeSchema,
  state: z.literal('clean'),
  downloadUrl: z.url(),
  expiresAt: z.iso.datetime(),
  sha256: z.string(),
  size: z.number().int(),
  fileName: z.string().nullable(),
  detectedType: z.string(),
});
export type UploadDownload = z.infer<typeof uploadDownloadSchema>;
