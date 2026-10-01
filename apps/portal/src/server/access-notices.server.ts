import type { AccessClient } from './access/client.server';
import type { DeclarantNotice, RepresentationsInput } from './access/types';
import { attempt, type NotFound, notFound, type Unavailable, unavailable } from './results';

/**
 * The access service's declarant endpoints (spec 10 FE-4): the requests someone made to see the
 * declarant's declaration, and their representations on each. Reduced to discriminated results
 * the pages branch on. Pure: the caller injects the client (`access-notices.ts` calls these as
 * the signed-in declarant).
 */

export type NoticesResult = { status: 'ok'; notices: DeclarantNotice[] } | Unavailable;

/**
 * `GET /v1/me/access-notices`, latest notified first. Someone the service does not know as a
 * declarant (403, 404) has had no requests about them: an empty list, not an error.
 */
export function listNotices(client: AccessClient): Promise<NoticesResult> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/me/access-notices');
    if (data) return { status: 'ok', notices: data };
    if (response.status === 403 || response.status === 404) return { status: 'ok', notices: [] };
    return unavailable;
  });
}

export type NoticeResult = { status: 'ok'; notice: DeclarantNotice } | NotFound | Unavailable;

/** One notice. The contract has no single read, so it is picked out of the declarant's list. */
export async function loadNotice(client: AccessClient, requestId: string): Promise<NoticeResult> {
  const list = await listNotices(client);
  if (list.status !== 'ok') return list;
  const notice = list.notices.find((each) => each.requestId === requestId);
  return notice ? { status: 'ok', notice } : notFound;
}

export type SaveResult =
  | { status: 'saved'; notice: DeclarantNotice }
  /** 409 `representations-closed`: the window closed, or the request closed, while editing. */
  | { status: 'closed' }
  /** 400: an attachment is not a clean upload of the declarant, or the body was refused. */
  | { status: 'invalid'; attachment: boolean }
  | NotFound
  | Unavailable;

/**
 * `PUT /v1/me/access-notices/{id}/representations`. The idempotency key belongs to one press of
 * Send, so a retry after a lost answer replays the service's first outcome.
 */
export function saveRepresentations(
  client: AccessClient,
  requestId: string,
  body: RepresentationsInput,
  idempotencyKey: string,
): Promise<SaveResult> {
  return attempt(async () => {
    const { data, error, response } = await client.PUT(
      '/v1/me/access-notices/{requestId}/representations',
      {
        params: { path: { requestId }, header: { 'Idempotency-Key': idempotencyKey } },
        body,
      },
    );
    if (data) return { status: 'saved', notice: data };
    switch (response.status) {
      case 400:
        return { status: 'invalid', attachment: pointsAtAttachment(error) };
      case 404:
        return notFound;
      case 409:
        return { status: 'closed' };
      default:
        return unavailable;
    }
  });
}

function pointsAtAttachment(error: unknown): boolean {
  const errors = (error as { errors?: unknown } | undefined)?.errors;
  return (
    Array.isArray(errors) &&
    errors.some((each) => String((each as { path?: unknown }).path).startsWith('attachments'))
  );
}
