import { randomUUID } from 'node:crypto';

import type { Apis } from './api.js';
import { ok } from './api.js';

/**
 * Uploads a file the way the apps do (spec 06 uploads): reserve, PUT the bytes to the presigned
 * URL, complete (scan and move to clean). Returns the upload id once it is clean.
 */
export async function uploadFile(
  api: Apis,
  file: {
    purpose:
      | 'roster-import'
      | 'declaration-attachment'
      | 'clarification-attachment'
      | 'action-response'
      | 'access-representation';
    contentType: string;
    fileName: string;
    bytes: Uint8Array;
  },
): Promise<string> {
  const reservation = ok(
    await api.documents.POST('/v1/uploads', {
      params: { header: { 'Idempotency-Key': randomUUID() } },
      body: {
        purpose: file.purpose,
        contentType: file.contentType,
        declaredSize: file.bytes.byteLength,
        fileName: file.fileName,
      },
    }),
    `reserve upload ${file.fileName}`,
  );
  const put = await fetch(reservation.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.contentType },
    body: file.bytes,
  });
  if (!put.ok) throw new Error(`PUT ${file.fileName}: ${String(put.status)} ${await put.text()}`);
  const upload = ok(
    await api.documents.POST('/v1/uploads/{id}/complete', {
      params: { path: { id: reservation.id }, header: { 'Idempotency-Key': randomUUID() } },
    }),
    `complete upload ${file.fileName}`,
  );
  if (upload.state !== 'clean') throw new Error(`Upload ${file.fileName} ended ${upload.state}`);
  return reservation.id;
}
