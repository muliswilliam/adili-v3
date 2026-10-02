import type { AccessClient, SubjectDocumentsClient } from './access/client.server';
import type { CertifiedCopy } from './access/types';
import { attempt, type NotFound, notFound, type Unavailable, unavailable } from './results';

/**
 * Certified copies of the declarant's submitted versions (spec 10 FE-4, S13) on the access
 * service, and their download from documents. Pure: the caller injects the clients
 * (`certified-copies.ts` calls these as the signed-in declarant).
 */

export type CopiesResult = { status: 'ok'; copies: CertifiedCopy[] } | Unavailable;

/**
 * `GET /v1/me/certified-copies`, latest asked for first. Someone the service does not know as a
 * declarant (403, 404) has none.
 */
export function listCopies(client: AccessClient): Promise<CopiesResult> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/me/certified-copies');
    if (data) return { status: 'ok', copies: data };
    if (response.status === 403 || response.status === 404) return { status: 'ok', copies: [] };
    return unavailable;
  });
}

export type CopyResult = { status: 'ok'; copy: CertifiedCopy } | NotFound | Unavailable;

/** One version a copy is asked for: the Commission it was filed with, the declaration, version. */
export interface CopyOf {
  commission: string;
  declarationId: string;
  version: number;
}

/**
 * `POST /v1/me/certified-copies`: the copy as it stands, `pending` until issued. Asking again for
 * the same version answers with the same copy (and tries a failed one again), so a retry is
 * safe; the idempotency key belongs to one press of the button.
 */
export function requestCopy(
  client: AccessClient,
  body: CopyOf,
  idempotencyKey: string,
): Promise<CopyResult> {
  return attempt(async () => {
    const { data, response } = await client.POST('/v1/me/certified-copies', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
      body,
    });
    if (data) return { status: 'ok', copy: data };
    return response.status === 404 ? notFound : unavailable;
  });
}

/** `GET /v1/me/certified-copies/{id}`, to follow a copy from `pending` to `issued` or `failed`. */
export function readCopy(client: AccessClient, copyId: string): Promise<CopyResult> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/me/certified-copies/{copyId}', {
      params: { path: { copyId } },
    });
    if (data) return { status: 'ok', copy: data };
    return response.status === 404 ? notFound : unavailable;
  });
}

export type CopyDownloadResult = { status: 'ok'; downloadUrl: string } | NotFound | Unavailable;

/**
 * `GET /v1/documents/{id}/download` as the declarant, the copy's subject: a presigned link valid
 * for minutes, so fetch one for each download.
 */
export function readCopyDownload(
  documents: SubjectDocumentsClient,
  documentId: string,
): Promise<CopyDownloadResult> {
  return attempt(async () => {
    const { data, response } = await documents.GET('/v1/documents/{documentId}/download', {
      params: { path: { documentId } },
    });
    if (data) return { status: 'ok', downloadUrl: data.downloadUrl };
    return response.status === 404 ? notFound : unavailable;
  });
}
