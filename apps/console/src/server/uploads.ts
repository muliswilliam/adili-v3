import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { ROSTER_CONTENT_TYPES, ROSTER_FILE_MAX_BYTES } from '../components/roster/roster-file';
import { asDocumentsViewer } from './as-viewer.server';
import {
  callDocuments,
  type DocumentsResult,
  type Upload,
  type UploadReservation,
} from './documents/client';

export const createRosterUploadInput = z.object({
  contentType: z.enum([ROSTER_CONTENT_TYPES.csv, ROSTER_CONTENT_TYPES.xlsx]),
  declaredSize: z.int().min(1).max(ROSTER_FILE_MAX_BYTES),
  fileName: z.string().min(1).max(255),
});

export type CreateRosterUploadInput = z.infer<typeof createRosterUploadInput>;

/**
 * `POST /v1/uploads` for a roster file: reserves an upload with purpose `roster-import` and
 * returns the presigned PUT the browser sends the bytes to. The documents service decides who
 * may upload (403 otherwise) and re-checks the type and size. The Idempotency-Key is the
 * upload attempt's, so a retried request reserves nothing twice.
 */
export const createRosterUpload = createServerFn({ method: 'POST' })
  .validator(createRosterUploadInput.extend({ idempotencyKey: z.uuid() }))
  .handler(({ data: { idempotencyKey, ...input } }): Promise<DocumentsResult<UploadReservation>> =>
    asDocumentsViewer((client) =>
      callDocuments(() =>
        client.POST('/v1/uploads', {
          params: { header: { 'Idempotency-Key': idempotencyKey } },
          body: { purpose: 'roster-import', ...input },
        }),
      ),
    ),
  );

/**
 * `POST /v1/uploads/{id}/complete`: checks, scans and moves the uploaded object, answering with
 * the final state (clean, infected or rejected). Takes a few seconds; see `DOCUMENTS_TIMEOUTS_MS`.
 * A retry with the same Idempotency-Key gets the final state back instead of a 409.
 */
export const completeUpload = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid(), idempotencyKey: z.uuid() }))
  .handler(({ data }): Promise<DocumentsResult<Upload>> =>
    asDocumentsViewer((client) =>
      callDocuments(() =>
        client.POST('/v1/uploads/{id}/complete', {
          params: { path: { id: data.id }, header: { 'Idempotency-Key': data.idempotencyKey } },
        }),
      ),
    ),
  );
