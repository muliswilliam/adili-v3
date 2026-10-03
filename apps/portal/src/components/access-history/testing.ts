import { vi } from 'vitest';

import { mockAccessFetch, resetAccessMock } from '../../server/access/mock.server';
import { resetHistoryMock } from '../../server/access/mock-history.server';
import { resetNoticesMock } from '../../server/access/mock-notices.server';
import type { AccessHistoryEntry, DeclarantNotice } from '../../server/access/types';

/** Test fixtures for Who accessed: the access mock's seeded history and notices, as of NOW. */

export const NOW = '2026-10-02T07:00:00.000Z';

const DECLARANT_TOKEN = `e30.${Buffer.from(
  JSON.stringify({ realm_access: { roles: ['declarant'] } }),
).toString('base64url')}.`;

async function read<T>(path: string): Promise<T> {
  const response = await mockAccessFetch(
    new Request(`http://access.test${path}`, {
      headers: { authorization: `Bearer ${DECLARANT_TOKEN}` },
    }),
  );
  return (await response.json()) as T;
}

/** The seeded history and the notices it is about, as of NOW. */
export async function seededHistory(): Promise<{
  entries: AccessHistoryEntry[];
  notices: DeclarantNotice[];
}> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(NOW));
  try {
    resetAccessMock(Date.parse(NOW));
    resetNoticesMock(Date.parse(NOW));
    resetHistoryMock(Date.parse(NOW));
    return {
      entries: await read<AccessHistoryEntry[]>('/v1/me/access-history'),
      notices: await read<DeclarantNotice[]>('/v1/me/access-notices'),
    };
  } finally {
    vi.useRealTimers();
  }
}
