import { mockAccessFetch, resetAccessMocks } from '../../server/access/mock.server';
import { MOCK_NOTICE_IDS } from '../../server/access/mock-notices.server';
import type { DeclarantNotice, FormKDeclarantNotice } from '../../server/access/types';

/** Test fixtures for the declarant's access request screens: the access mock's seeded notices. */

export const NOW = '2026-10-02T07:00:00.000Z';

export const IDS = MOCK_NOTICE_IDS;

const DECLARANT_TOKEN = `e30.${Buffer.from(
  JSON.stringify({ realm_access: { roles: ['declarant'] } }),
).toString('base64url')}.`;

/** Every seeded notice, latest notified first, as of NOW. */
export async function seededNotices(): Promise<DeclarantNotice[]> {
  resetAccessMocks(Date.parse(NOW));
  const response = await mockAccessFetch(
    new Request('http://access.test/v1/me/access-notices', {
      headers: { authorization: `Bearer ${DECLARANT_TOKEN}` },
    }),
  );
  return (await response.json()) as DeclarantNotice[];
}

export async function seededNotice(id: string): Promise<DeclarantNotice> {
  const found = (await seededNotices()).find((notice) => notice.requestId === id);
  if (!found) throw new Error(`No seeded notice ${id}`);
  return found;
}

/** A seeded Form K notice (not a law-enforcement grant). */
export async function seededFormKNotice(id: string): Promise<FormKDeclarantNotice> {
  const found = await seededNotice(id);
  if (found.kind !== 'form-k') throw new Error(`Seeded notice ${id} is not a Form K request`);
  return found;
}
