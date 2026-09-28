import type { DeclarationsClient } from './declarations/client.server';
import type { ObligationDetail, ObligationGroup } from './declarations/types';

export type MyObligationsResult =
  | { status: 'ok'; groups: ObligationGroup[] }
  /** `GET /v1/me/obligations` answered 404: the caller has no person, so is not a declarant. */
  | { status: 'not-declarant' }
  | { status: 'unavailable' };

export type ObligationDetailResult =
  | { status: 'ok'; obligation: ObligationDetail }
  | { status: 'not-found' }
  | { status: 'unavailable' };

/** `GET /v1/me/obligations`: the declarant's obligations, grouped by Commission. */
export async function loadMyObligations(client: DeclarationsClient): Promise<MyObligationsResult> {
  try {
    const { data, response } = await client.GET('/v1/me/obligations');
    if (data) return { status: 'ok', groups: data.groups };
    return response.status === 404 ? { status: 'not-declarant' } : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

/** `GET /v1/obligations/{id}`: one of the declarant's obligations with its reminder history. */
export async function loadObligation(
  client: DeclarationsClient,
  id: string,
): Promise<ObligationDetailResult> {
  try {
    const { data, response } = await client.GET('/v1/obligations/{id}', {
      params: { path: { id } },
    });
    if (data) return { status: 'ok', obligation: data };
    return response.status === 404 ? { status: 'not-found' } : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}
