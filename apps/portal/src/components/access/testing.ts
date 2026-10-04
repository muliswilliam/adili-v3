import {
  MOCK_ACCESS_REQUEST_IDS,
  mockAccessFetch,
  resetAccessMocks,
} from '../../server/access/mock.server';
import type { AccessRequest } from '../../server/access/types';

export { toSummary } from '../../server/access-requests.server';

/** Test fixtures for the access request screens: the access mock's seeded requests. */

export const NOW = Date.parse('2026-10-02T07:00:00Z');

export const IDS = MOCK_ACCESS_REQUEST_IDS;

const APPLICANT_TOKEN = `e30.${Buffer.from(
  JSON.stringify({ realm_access: { roles: ['applicant'] } }),
).toString('base64url')}.`;

/** Every seeded request, latest first, as of NOW. */
export async function seededRequests(): Promise<AccessRequest[]> {
  resetAccessMocks(NOW);
  const response = await mockAccessFetch(
    new Request('http://access.test/v1/access/requests', {
      headers: { authorization: `Bearer ${APPLICANT_TOKEN}` },
    }),
  );
  return (await response.json()) as AccessRequest[];
}

export async function seededRequest(id: string): Promise<AccessRequest> {
  const found = (await seededRequests()).find((request) => request.id === id);
  if (!found) throw new Error(`No seeded request ${id}`);
  return found;
}
