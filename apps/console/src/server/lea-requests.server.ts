import type { AccessClient } from './access/client.server';
import type {
  AccessCommission,
  AccessProblem,
  DecisionInput,
  LeaRequest,
  LeaRequestInput,
  RosterCandidates,
  VerifyLeaRequest,
} from './access/types';
import type { AccessResult } from './access-requests.server';
import type { components as DocumentsComponents } from './documents/api.gen';
import type { DocumentsClient } from './documents/client';
import { callService, type ServiceResult } from './service-call';

type DocumentSchemas = DocumentsComponents['schemas'];

/**
 * The access service's law enforcement endpoints (spec 10 FE-6, S11) folded into results the
 * console switches on: the Commission's access officer verifies and decides, the law enforcement
 * officer files, follows and downloads. Pure: the caller injects the clients
 * (`lea-requests.ts` makes them for the signed-in user).
 */

/** `GET /v1/lea/requests/{id}`: the whole request for the Commission, the officer's own view for them. */
export function loadLeaRequest(
  client: AccessClient,
  id: string,
): Promise<AccessResult<LeaRequest>> {
  return callService(() =>
    client.GET('/v1/lea/requests/{leaRequestId}', { params: { path: { leaRequestId: id } } }),
  );
}

/** `GET .../roster-candidates?q=`: the Commission's roster records by name or file number. */
export function searchLeaRoster(
  client: AccessClient,
  id: string,
  q: string,
): Promise<AccessResult<RosterCandidates>> {
  return callService(() =>
    client.GET('/v1/lea/requests/{leaRequestId}/roster-candidates', {
      params: { path: { leaRequestId: id }, query: { q } },
    }),
  );
}

/**
 * `POST .../verify`: the access officer confirms the request comes from the agency account it
 * shows and states its reason, and identifies the officer sought. The key makes a retry safe.
 */
export function verifyLeaRequest(
  client: AccessClient,
  id: string,
  body: VerifyLeaRequest,
  idempotencyKey: string,
): Promise<AccessResult<LeaRequest>> {
  return callService(() =>
    client.POST('/v1/lea/requests/{leaRequestId}/verify', {
      params: { path: { leaRequestId: id }, header: { 'Idempotency-Key': idempotencyKey } },
      body,
    }),
  );
}

/** `POST .../decision`: grant or deny, final. */
export function decideLeaRequest(
  client: AccessClient,
  id: string,
  input: DecisionInput,
  idempotencyKey: string,
): Promise<AccessResult<LeaRequest>> {
  return callService(() =>
    client.POST('/v1/lea/requests/{leaRequestId}/decision', {
      params: { path: { leaRequestId: id }, header: { 'Idempotency-Key': idempotencyKey } },
      body: input,
    }),
  );
}

/** `GET /v1/lea/requests`: the signed-in officer's requests, latest first. */
export function listMyLeaRequests(client: AccessClient): Promise<AccessResult<LeaRequest[]>> {
  return callService(() => client.GET('/v1/lea/requests'));
}

/** `POST /v1/lea/requests`: a written request, received with its LEA reference. */
export function submitLeaRequest(
  client: AccessClient,
  input: LeaRequestInput,
  idempotencyKey: string,
): Promise<AccessResult<LeaRequest>> {
  return callService(() =>
    client.POST('/v1/lea/requests', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
      body: input,
    }),
  );
}

/** `GET /v1/access/commissions`: the Commissions a request can address, with their years. */
export function listRequestCommissions(
  client: AccessClient,
): Promise<AccessResult<AccessCommission[]>> {
  return callService(() => client.GET('/v1/access/commissions'));
}

type DocumentDownload = DocumentSchemas['DocumentDownload'];

/** A link to the package, or why there is none. */
export type PackageDownloadResult =
  | { ok: true; data: DocumentDownload }
  /** 410: the package's download window has closed. */
  | { ok: false; error: { kind: 'window-closed' } }
  | ServiceResult<never, AccessProblem>;

/**
 * `GET /v1/documents/{id}/download` on the documents service, as the officer the package was
 * issued to: a presigned link valid for minutes, so fetch one for each download. Documents
 * records each link it hands out (the access register counts them) and refuses one once the
 * window has closed.
 */
export async function packageDownload(
  documents: DocumentsClient,
  documentId: string,
): Promise<PackageDownloadResult> {
  const result = await callService<DocumentDownload, AccessProblem>(() =>
    documents.GET('/v1/documents/{documentId}/download', { params: { path: { documentId } } }),
  );
  if (!result.ok && result.error.kind === 'problem' && result.error.problem.status === 410) {
    return { ok: false, error: { kind: 'window-closed' } };
  }
  return result;
}
