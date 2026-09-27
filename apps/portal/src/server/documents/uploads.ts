import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';

import { getBff } from '../bff.server';
import type { Unauthenticated } from '../declarations';
import { documentsClient, type DocumentsClient } from './client.server';
import {
  checkUpload,
  completeUpload,
  reserveAttachmentUpload,
  type ReserveResult,
  type UploadCheck,
} from './uploads.server';

/**
 * Server functions for uploading a declaration attachment, called as the signed-in declarant.
 * The token stays on the server; the browser only gets the presigned URL to PUT the bytes to.
 */

async function asDeclarant<T>(
  call: (client: DocumentsClient) => Promise<T>,
): Promise<T | Unauthenticated> {
  const session = await getBff().getSession(getRequest());
  if (!session) return { status: 'unauthenticated' };
  return call(documentsClient(session.accessToken));
}

const uploadInput = z.object({ uploadId: z.uuid() });

export const createAttachmentUpload = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      contentType: z.string().min(1).max(255),
      size: z.number().int().min(1),
      fileName: z.string().min(1),
    }),
  )
  .handler(({ data }): Promise<ReserveResult | Unauthenticated> =>
    asDeclarant((client) => reserveAttachmentUpload(client, data)),
  );

export const completeAttachmentUpload = createServerFn({ method: 'POST' })
  .validator(uploadInput)
  .handler(({ data }): Promise<UploadCheck | Unauthenticated> =>
    asDeclarant((client) => completeUpload(client, data.uploadId)),
  );

export const getAttachmentUpload = createServerFn({ method: 'GET' })
  .validator(uploadInput)
  .handler(({ data }): Promise<UploadCheck | Unauthenticated> =>
    asDeclarant((client) => checkUpload(client, data.uploadId)),
  );
