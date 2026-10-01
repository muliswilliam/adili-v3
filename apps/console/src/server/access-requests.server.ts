import type { FormKV1 } from '@adili/forms';

import { type QueueSearch, queueServiceQuery } from '../components/access/queue-query';
import type { components } from './access/api.gen';
import type { AccessClient } from './access/client.server';
import type {
  AccessProblem,
  AttachmentDownload,
  OfficerRequestView,
  QueuePage,
  RosterCandidates,
} from './access/types';
import { callService, type ServiceResult } from './service-call';

/**
 * The access service's officer endpoints (spec 10 FE-5, S3, S16) folded into results the queue
 * and the request page switch on. Pure: the caller injects the client (`access-requests.ts`
 * makes it for the signed-in access officer or supervisor).
 */

export type AccessResult<T> = ServiceResult<T, AccessProblem>;

type Schemas = components['schemas'];

/** `GET /v1/commissions/{slug}/access/requests`: one page of the queue for the filters. */
export function loadQueue(
  client: AccessClient,
  slug: string,
  search: QueueSearch,
  limit?: number,
): Promise<AccessResult<QueuePage>> {
  return callService(() =>
    client.GET('/v1/commissions/{slug}/access/requests', {
      params: { path: { slug }, query: queueServiceQuery(search, limit) },
    }),
  );
}

/** The access service's view, with its Form K as the form-k.v1 document the service validated. */
async function asOfficerView(
  call: Promise<ServiceResult<Schemas['OfficerRequestView'], AccessProblem>>,
): Promise<AccessResult<OfficerRequestView>> {
  const result = await call;
  if (!result.ok) return result;
  return { ok: true, data: { ...result.data, formK: result.data.formK as unknown as FormKV1 } };
}

/** `GET /v1/access/requests/{requestId}/officer`: Form K, representations and the register. */
export function loadRequest(
  client: AccessClient,
  requestId: string,
): Promise<AccessResult<OfficerRequestView>> {
  return asOfficerView(
    callService(() =>
      client.GET('/v1/access/requests/{requestId}/officer', {
        params: { path: { requestId } },
      }),
    ),
  );
}

/** `GET .../roster-candidates?q=`: the Commission's roster records by name or file number. */
export function searchRoster(
  client: AccessClient,
  requestId: string,
  q: string,
): Promise<AccessResult<RosterCandidates>> {
  return callService(() =>
    client.GET('/v1/access/requests/{requestId}/roster-candidates', {
      params: { path: { requestId }, query: { q } },
    }),
  );
}

/**
 * `POST .../resolve`: the officer Part II names is this roster record (the declarant is notified
 * next), or, with null, cannot be identified (the request closes). The key makes a retry safe.
 */
export function resolveOfficer(
  client: AccessClient,
  requestId: string,
  rosterRecordId: string | null,
  idempotencyKey: string,
): Promise<AccessResult<OfficerRequestView>> {
  return asOfficerView(
    callService(() =>
      client.POST('/v1/access/requests/{requestId}/resolve', {
        params: { path: { requestId }, header: { 'Idempotency-Key': idempotencyKey } },
        body: { rosterRecordId },
      }),
    ),
  );
}

/** `POST .../verify-applicant`: the passport applicant's particulars were checked. */
export function verifyApplicant(
  client: AccessClient,
  requestId: string,
  note: string,
  idempotencyKey: string,
): Promise<AccessResult<OfficerRequestView>> {
  return asOfficerView(
    callService(() =>
      client.POST('/v1/access/requests/{requestId}/verify-applicant', {
        params: { path: { requestId }, header: { 'Idempotency-Key': idempotencyKey } },
        body: { verified: true, note },
      }),
    ),
  );
}

/**
 * `POST .../decision`: the access officer's final decision (S6). The access service checks it
 * against the requested scope (400 by field) and that the request is under decision (409); the
 * key makes a retry of the same decision safe.
 */
export function decideRequest(
  client: AccessClient,
  requestId: string,
  input: Schemas['DecisionInput'],
  idempotencyKey: string,
): Promise<AccessResult<OfficerRequestView>> {
  return asOfficerView(
    callService(() =>
      client.POST('/v1/access/requests/{requestId}/decision', {
        params: { path: { requestId }, header: { 'Idempotency-Key': idempotencyKey } },
        body: input,
      }),
    ),
  );
}

/** A short-lived link to a file attached to the declarant's representations (audited). */
export function attachmentLink(
  client: AccessClient,
  requestId: string,
  uploadId: string,
): Promise<AccessResult<AttachmentDownload>> {
  return callService(() =>
    client.GET('/v1/access/requests/{requestId}/representations/attachments/{uploadId}/download', {
      params: { path: { requestId, uploadId } },
    }),
  );
}
