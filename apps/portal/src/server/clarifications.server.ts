import { attempt, type NotFound, notFound, type Unavailable, unavailable } from './results';
import type { ReviewClient } from './review/client.server';
import type { ClarificationResponseInput, DeclarantClarification } from './review/types';

/**
 * The review service's declarant clarification endpoints (spec 07a), reduced to discriminated
 * results the clarification page can branch on. Pure: the caller injects the client (see
 * `clarifications.ts` for the server functions that call these as the signed-in declarant).
 */

/** Another clarification on the same thread, by reference for the page's banners. */
export interface ClarificationLink {
  id: string;
  reference: string | null;
}

export type ClarificationPageResult =
  | {
      status: 'ok';
      clarification: DeclarantClarification;
      /** Further clarifications raised on this one's response. */
      followUps: ClarificationLink[];
      /** The clarification this one follows up, when it is a follow-up. */
      original: ClarificationLink | null;
    }
  | NotFound
  | Unavailable;

function linkTo(clarification: DeclarantClarification): ClarificationLink {
  return { id: clarification.id, reference: clarification.reference };
}

/**
 * `GET /v1/me/clarifications/{id}`, plus the list (`GET /v1/me/clarifications`) to find the
 * follow-ups on either side. The list is a nicety: when it fails the page still shows.
 */
export function loadClarificationPage(
  client: ReviewClient,
  id: string,
): Promise<ClarificationPageResult> {
  return attempt(async () => {
    const [one, list] = await Promise.all([
      client.GET('/v1/me/clarifications/{clarificationId}', {
        params: { path: { clarificationId: id } },
      }),
      client.GET('/v1/me/clarifications').catch(() => null),
    ]);
    if (!one.data) return one.response.status === 404 ? notFound : unavailable;
    const clarification = one.data;
    const all = list?.data ?? [];
    const original = clarification.followUpOf
      ? (all.find((each) => each.id === clarification.followUpOf) ?? null)
      : null;
    return {
      status: 'ok',
      clarification,
      followUps: all.filter((each) => each.followUpOf === clarification.id).map(linkTo),
      original: original
        ? linkTo(original)
        : clarification.followUpOf
          ? { id: clarification.followUpOf, reference: null }
          : null,
    };
  });
}

export type ConflictReason = 'already-responded' | 'not-open' | 'attachment-not-clean';

export type RespondResult =
  | { status: 'responded'; clarification: DeclarantClarification }
  /** 409: answered already (maybe on another device), closed, or an attachment is not clean. */
  | { status: 'conflict'; reason: ConflictReason }
  /** 400: the service refused the body; the form's own checks should prevent it. */
  | { status: 'invalid' }
  | NotFound
  | Unavailable;

function conflictReason(error: unknown): ConflictReason {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === 'attachment-not-clean' || code === 'not-open') return code;
  return 'already-responded';
}

/**
 * `POST /v1/me/clarifications/{id}/response`, once. The idempotency key belongs to the form, so
 * a retry after a lost answer replays the service's first outcome instead of a 409.
 */
export function respondToClarification(
  client: ReviewClient,
  id: string,
  items: ClarificationResponseInput['items'],
  idempotencyKey: string,
): Promise<RespondResult> {
  return attempt(async () => {
    const { data, error, response } = await client.POST(
      '/v1/me/clarifications/{clarificationId}/response',
      {
        params: { path: { clarificationId: id }, header: { 'Idempotency-Key': idempotencyKey } },
        body: { items },
      },
    );
    if (data) return { status: 'responded', clarification: data };
    switch (response.status) {
      case 400:
        return { status: 'invalid' };
      case 404:
        return notFound;
      case 409:
        return { status: 'conflict', reason: conflictReason(error) };
      default:
        return unavailable;
    }
  });
}
