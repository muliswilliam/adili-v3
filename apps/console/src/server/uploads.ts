import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { ROSTER_CONTENT_TYPES, ROSTER_FILE_MAX_BYTES } from '../components/roster/roster-file';
import { getBff } from './bff.server';
import {
  callDocuments,
  createDocumentsClient,
  type DocumentsClient,
  type DocumentsResult,
  type Upload,
  type UploadReservation,
} from './documents/client';
import { env } from './env.server';

/** Runs `work` with a documents client acting as the signed-in user. */
async function asViewer<T>(
  work: (client: DocumentsClient) => Promise<DocumentsResult<T>>,
): Promise<DocumentsResult<T>> {
  const session = await getBff().getSession(getRequest());
  if (!session) {
    return { ok: false, error: { kind: 'unauthenticated' } };
  }
  return work(
    createDocumentsClient({ baseUrl: env().DOCUMENTS_API_URL, accessToken: session.accessToken }),
  );
}

export const createRosterUploadInput = z.object({
  contentType: z.enum([ROSTER_CONTENT_TYPES.csv, ROSTER_CONTENT_TYPES.xlsx]),
  declaredSize: z.int().min(1).max(ROSTER_FILE_MAX_BYTES),
  fileName: z.string().min(1).max(255),
});

export type CreateRosterUploadInput = z.infer<typeof createRosterUploadInput>;

/**
 * `POST /v1/uploads` for a roster file: reserves an upload with purpose `roster-import` and
 * returns the presigned PUT the browser sends the bytes to. The documents service decides who
 * may upload (403 otherwise) and re-checks the type and size.
 */
export const createRosterUpload = createServerFn({ method: 'POST' })
  .validator(createRosterUploadInput)
  .handler(({ data }): Promise<DocumentsResult<UploadReservation>> =>
    asViewer((client) =>
      callDocuments(() =>
        client.POST('/v1/uploads', { body: { purpose: 'roster-import', ...data } }),
      ),
    ),
  );

/**
 * `POST /v1/uploads/{id}/complete`: checks, scans and moves the uploaded object, answering with
 * the final state (clean, infected or rejected). Takes a few seconds; see `DOCUMENTS_TIMEOUTS_MS`.
 */
export const completeUpload = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(({ data }): Promise<DocumentsResult<Upload>> =>
    asViewer((client) =>
      callDocuments(() =>
        client.POST('/v1/uploads/{id}/complete', { params: { path: { id: data.id } } }),
      ),
    ),
  );
