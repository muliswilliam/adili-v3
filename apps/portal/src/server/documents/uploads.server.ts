import { attempt, type NotFound, notFound, type Unavailable, unavailable } from '../results';
import type { DocumentsClient } from './client.server';
import type {
  CreateUpload,
  Upload,
  UploadPurpose,
  UploadRejection,
  UploadReservation,
} from './types';

/**
 * The documents service's upload flow for declaration and clarification attachments
 * (documents.yaml), reduced to discriminated results. Pure: the caller injects the client (see
 * `uploads.ts` for the server functions). The browser PUTs the bytes to the reservation's
 * `uploadUrl` itself; these never see the file.
 *
 * reserve (`POST /v1/uploads`) -> browser PUT -> complete (`POST /v1/uploads/{id}/complete`,
 * scans) -> poll `GET /v1/uploads/{id}` while the scan has not finished.
 */

export interface AttachmentFile {
  contentType: string;
  /** Bytes, as the browser reports them. */
  size: number;
  fileName: string;
}

export type ReserveResult =
  | { status: 'reserved'; reservation: UploadReservation }
  /** 400: the type or size is outside the declaration attachment limits. */
  | { status: 'rejected'; reason: 'type' | 'size' }
  | Unavailable;

/** Purposes whose files the declarant attaches: PDF, JPEG, PNG or HEIC up to 20 MB each. */
export const ATTACHMENT_PURPOSES = [
  'declaration-attachment',
  'clarification-attachment',
] as const satisfies readonly UploadPurpose[];

export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];

/** `POST /v1/uploads` with the `declaration-attachment` purpose, or the one given. */
export function reserveAttachmentUpload(
  client: DocumentsClient,
  file: AttachmentFile,
  purpose: AttachmentPurpose = 'declaration-attachment',
): Promise<ReserveResult> {
  return attempt(async () => {
    const body: CreateUpload = {
      purpose,
      contentType: file.contentType,
      declaredSize: file.size,
      fileName: file.fileName.slice(0, 255),
    };
    const { data, error, response } = await client.POST('/v1/uploads', {
      params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
      body,
    });
    if (data) return { status: 'reserved', reservation: data };
    if (response.status === 400) {
      const code = (error as { code?: unknown } | undefined)?.code;
      return { status: 'rejected', reason: code === 'size' ? 'size' : 'type' };
    }
    return unavailable;
  });
}

export type UploadCheck =
  | { status: 'clean'; sha256: string; size: number }
  /** Not final yet: the bytes are still arriving or being scanned. Ask again. */
  | { status: 'scanning' }
  | { status: 'infected' }
  | { status: 'rejected'; reason: 'type' | 'size' | 'missing' | 'timeout' }
  | { status: 'expired' }
  | NotFound
  | Unavailable;

/** `encoding` is about CSV text, so for an attachment it reads as the wrong type. */
function rejectionOf(rejection: UploadRejection | null): 'type' | 'size' | 'missing' | 'timeout' {
  return rejection === null || rejection === 'encoding' ? 'type' : rejection;
}

function checkOf(upload: Upload): UploadCheck {
  switch (upload.state) {
    case 'clean':
      return upload.sha256
        ? { status: 'clean', sha256: upload.sha256, size: upload.size ?? upload.declaredSize }
        : { status: 'scanning' };
    case 'infected':
      return { status: 'infected' };
    case 'rejected':
      return { status: 'rejected', reason: rejectionOf(upload.rejection) };
    // Left unlinked for 30 days, so the orphan sweep deleted the file: like an expired upload,
    // it has to be uploaded again.
    case 'expired':
    case 'deleted':
      return { status: 'expired' };
    case 'awaiting-upload':
      return { status: 'scanning' };
  }
}

/** `GET /v1/uploads/{id}`: where the upload is now. */
export function checkUpload(client: DocumentsClient, id: string): Promise<UploadCheck> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/uploads/{id}', {
      params: { path: { id } },
    });
    if (data) return checkOf(data);
    return response.status === 404 ? notFound : unavailable;
  });
}

/**
 * `POST /v1/uploads/{id}/complete` after the browser's PUT: verifies and scans the file. A 409
 * (already completed, e.g. a retried request) reads the state instead.
 */
export function completeUpload(client: DocumentsClient, id: string): Promise<UploadCheck> {
  return attempt(async () => {
    const { data, response } = await client.POST('/v1/uploads/{id}/complete', {
      params: { path: { id }, header: { 'Idempotency-Key': crypto.randomUUID() } },
    });
    if (data) return checkOf(data);
    if (response.status === 409) return checkUpload(client, id);
    return response.status === 404 ? notFound : unavailable;
  });
}
