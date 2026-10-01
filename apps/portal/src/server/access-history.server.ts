import type { AccessClient } from './access/client.server';
import type { AccessHistoryEntry } from './access/types';
import { attempt, type Unavailable, unavailable } from './results';

/**
 * "Who accessed my declaration" on the access service (spec 10 FE-4, S12). Pure: the caller
 * injects the client (`access-history.ts` calls it as the signed-in declarant).
 */

export type HistoryResult = { status: 'ok'; entries: AccessHistoryEntry[] } | Unavailable;

/**
 * `GET /v1/me/access-history`, newest first. The service already applies who sees what (Form K
 * requests from notification, law enforcement from the grant, staff never named). Someone it
 * does not know as a declarant (403, 404) has no history: an empty list, not an error.
 */
export function loadHistory(client: AccessClient): Promise<HistoryResult> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/me/access-history');
    if (data) return { status: 'ok', entries: data };
    if (response.status === 403 || response.status === 404) return { status: 'ok', entries: [] };
    return unavailable;
  });
}
