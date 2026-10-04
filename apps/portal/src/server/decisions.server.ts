import { attempt, type NotFound, notFound, type Unavailable, unavailable } from './results';
import type { ReviewClient } from './review/client.server';
import type { DeclarantDecision } from './review/types';

/**
 * The review service's declarant decision endpoints (spec 08 FE-7, S17), reduced to results the
 * Home card can branch on. Pure: the caller injects the client (see `decisions.ts`).
 */

export type MyDecisionsResult = { status: 'ok'; decisions: DeclarantDecision[] } | Unavailable;

/** `GET /v1/me/decisions`: the declarant's approved determinations, newest first. */
export function loadMyDecisions(client: ReviewClient): Promise<MyDecisionsResult> {
  return attempt(async () => {
    const { data } = await client.GET('/v1/me/decisions');
    if (!data) return unavailable;
    const decisions = [...data].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
    return { status: 'ok', decisions };
  });
}

export type DecisionLetterResult = { status: 'ok'; downloadUrl: string } | NotFound | Unavailable;

/**
 * `GET /v1/review/determinations/{id}/letter`: the decision letter's download, through the
 * portal's own document route (the documents owner rule). A bulk closure's letter is issued on
 * this first request, so it can take a moment; a 502 or 503 (documents could not issue it) is
 * worth retrying.
 */
export function decisionLetter(
  client: ReviewClient,
  determinationId: string,
): Promise<DecisionLetterResult> {
  return attempt(async () => {
    const { data, response } = await client.GET(
      '/v1/review/determinations/{determinationId}/letter',
      { params: { path: { determinationId } } },
    );
    if (data?.downloadUrl) return { status: 'ok', downloadUrl: data.downloadUrl };
    return response.status === 404 ? notFound : unavailable;
  });
}
