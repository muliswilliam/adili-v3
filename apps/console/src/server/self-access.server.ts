import type { components } from './access/api.gen';
import type { AccessClient } from './access/client.server';
import type { AccessProblem, RosterCandidates } from './access/types';
import type { DocumentsClient, Upload, UploadReservation } from './documents/client';
import type { ProofUploadInput } from '../components/access/self-access/proof-upload';
import { callService, type ServiceResult } from './service-call';

/**
 * The access service's written self-access endpoints (spec 10 slice #302, Administrative
 * Mechanism 32) and the documents calls around them, folded into results the Certified copies
 * screens switch on. Pure: the caller injects the clients (`self-access.ts` makes them for the
 * signed-in access officer or supervisor).
 */

type Schemas = components['schemas'];

export type SelfAccessResult<T> = ServiceResult<T, AccessProblem>;
export type DeclarantVersions = Schemas['DeclarantVersions'];
export type DeclarantVersion = Schemas['DeclarantVersion'];
export type SelfAccessApplicationInput = Schemas['SelfAccessApplicationInput'];
export type SelfAccessApplication = Schemas['SelfAccessApplication'];
export type SelfAccessApplicationDetail = Schemas['SelfAccessApplicationDetail'];
export type SelfAccessPage = Schemas['SelfAccessPage'];
export type SelfAccessStatus = SelfAccessApplication['status'];
export type DeliveryMethod = SelfAccessApplication['deliveryMethod'];
export type CertifiedCopy = Schemas['CertifiedCopy'];

/** How many applications a page of the list holds. */
export const SELF_ACCESS_PAGE_SIZE = 20;

/** `GET .../self-access/declarants?q=`: the Commission's roster records by name or file number. */
export function searchDeclarants(
  client: AccessClient,
  slug: string,
  q: string,
): Promise<SelfAccessResult<RosterCandidates>> {
  return callService(() =>
    client.GET('/v1/commissions/{slug}/access/self-access/declarants', {
      params: { path: { slug }, query: { q } },
    }),
  );
}

/** `GET .../declarants/{rosterRecordId}/versions`: the versions a certified copy can be of. */
export function declarantVersions(
  client: AccessClient,
  slug: string,
  rosterRecordId: string,
): Promise<SelfAccessResult<DeclarantVersions>> {
  return callService(() =>
    client.GET('/v1/commissions/{slug}/access/self-access/declarants/{rosterRecordId}/versions', {
      params: { path: { slug, rosterRecordId } },
    }),
  );
}

/**
 * `POST .../self-access`: records the application and orders its certified copy at once. The
 * key makes a retry of the same submission safe.
 */
export function recordApplication(
  client: AccessClient,
  slug: string,
  input: SelfAccessApplicationInput,
  idempotencyKey: string,
): Promise<SelfAccessResult<SelfAccessApplicationDetail>> {
  return callService(() =>
    client.POST('/v1/commissions/{slug}/access/self-access', {
      params: { path: { slug }, header: { 'Idempotency-Key': idempotencyKey } },
      body: input,
    }),
  );
}

/** `GET .../self-access`: one page of the Commission's applications, earliest deadline first. */
export function listApplications(
  client: AccessClient,
  slug: string,
  cursor: string | undefined,
  limit: number = SELF_ACCESS_PAGE_SIZE,
): Promise<SelfAccessResult<SelfAccessPage>> {
  return callService(() =>
    client.GET('/v1/commissions/{slug}/access/self-access', {
      params: { path: { slug }, query: { limit, ...(cursor ? { cursor } : {}) } },
    }),
  );
}

/** `GET /v1/access/self-access/{applicationId}`: one application with its certified copy. */
export function loadApplication(
  client: AccessClient,
  applicationId: string,
): Promise<SelfAccessResult<SelfAccessApplicationDetail>> {
  return callService(() =>
    client.GET('/v1/access/self-access/{applicationId}', {
      params: { path: { applicationId } },
    }),
  );
}

/** `POST .../delivered`: the issued copy was collected or dispatched, as the application says. */
export function markDelivered(
  client: AccessClient,
  applicationId: string,
  idempotencyKey: string,
): Promise<SelfAccessResult<SelfAccessApplicationDetail>> {
  return callService(() =>
    client.POST('/v1/access/self-access/{applicationId}/delivered', {
      params: { path: { applicationId }, header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

/**
 * `POST /v1/uploads` for a representative's written authority or ID: an upload of purpose
 * `access-representation` by the access officer, which only they can then attach.
 */
export function reserveProofUpload(
  client: DocumentsClient,
  input: ProofUploadInput,
  idempotencyKey: string,
): Promise<SelfAccessResult<UploadReservation>> {
  return callService(() =>
    client.POST('/v1/uploads', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
      body: { purpose: 'access-representation', ...input },
    }),
  );
}

/** `POST /v1/uploads/{id}/complete`: scans the proof and answers with its final state. */
export function completeProofUpload(
  client: DocumentsClient,
  id: string,
  idempotencyKey: string,
): Promise<SelfAccessResult<Upload>> {
  return callService(() =>
    client.POST('/v1/uploads/{id}/complete', {
      params: { path: { id }, header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

/** A short-lived link to the signed PDF of a certified copy. */
export interface CopyDownload {
  downloadUrl: string;
  expiresAt: string;
}

/**
 * `GET /v1/documents/{documentId}/download` with the officer's own token: documents hands the
 * recording officer, named on the copy, a five-minute link and records the download (audited,
 * `document.downloaded.v1`); anyone else gets 404.
 */
export async function copyDownload(
  client: DocumentsClient,
  documentId: string,
): Promise<SelfAccessResult<CopyDownload>> {
  const result = await callService(() =>
    client.GET('/v1/documents/{documentId}/download', {
      params: { path: { documentId } },
    }),
  );
  if (!result.ok) return result;
  const { downloadUrl, expiresAt } = result.data;
  return { ok: true, data: { downloadUrl, expiresAt } };
}
