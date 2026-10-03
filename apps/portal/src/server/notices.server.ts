import { attempt, type NotFound, notFound, type Unavailable, unavailable } from './results';
import type { ReviewClient } from './review/client.server';
import type { DeclarantNotice } from './review/types';

/**
 * The review service's declarant notice endpoints (spec 08 FE-7, S9, S17): the notices to comply
 * and warnings issued to the declarant, and their one response to each. Pure: the caller injects
 * the client (see `notices.ts` for the server functions that call these as the declarant).
 */

export type MyNoticesResult = { status: 'ok'; notices: DeclarantNotice[] } | Unavailable;

/** `GET /v1/me/notices`: every administrative action issued to the declarant. */
export function loadMyNotices(client: ReviewClient): Promise<MyNoticesResult> {
  return attempt(async () => {
    const { data } = await client.GET('/v1/me/notices');
    return data ? { status: 'ok', notices: data } : unavailable;
  });
}

export type NoticeConflict =
  'already-responded' | 'notice-closed' | 'attachment-not-clean' | 'attachment-not-accepted';

const CONFLICTS: readonly NoticeConflict[] = [
  'already-responded',
  'notice-closed',
  'attachment-not-clean',
  'attachment-not-accepted',
];

export type NoticeRespondResult =
  | { status: 'responded'; notice: DeclarantNotice }
  /** 409: answered already (maybe on another device), closed, or a document not accepted. */
  | { status: 'conflict'; reason: NoticeConflict }
  /** 400: the service refused the body; the form's own checks should prevent it. */
  | { status: 'invalid' }
  | NotFound
  | Unavailable;

function conflictOf(error: unknown): NoticeConflict {
  const code = (error as { code?: unknown; type?: unknown } | undefined)?.code;
  return CONFLICTS.find((each) => each === code) ?? 'already-responded';
}

/**
 * `POST /v1/me/notices/{actionId}/response`, once. The key belongs to the form, so a retry after
 * a lost answer replays the service's first outcome instead of a 409.
 */
export function respondToNotice(
  client: ReviewClient,
  actionId: string,
  text: string,
  attachments: string[],
  idempotencyKey: string,
): Promise<NoticeRespondResult> {
  return attempt(async () => {
    const { data, error, response } = await client.POST('/v1/me/notices/{actionId}/response', {
      params: { path: { actionId }, header: { 'Idempotency-Key': idempotencyKey } },
      body: { text, attachments },
    });
    if (data) return { status: 'responded', notice: data };
    switch (response.status) {
      case 400:
        return { status: 'invalid' };
      case 404:
        return notFound;
      case 409:
        return { status: 'conflict', reason: conflictOf(error) };
      default:
        return unavailable;
    }
  });
}
