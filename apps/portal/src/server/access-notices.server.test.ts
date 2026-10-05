import createClient from 'openapi-fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listNotices, loadNotice, saveRepresentations } from './access-notices.server';
import {
  failNextAccessCall,
  mockAccessFetch,
  resetAccessMocks,
  setAccessMockLatency,
} from './access/mock.server';
import { MOCK_NOTICE_IDS as IDS } from './access/mock-notices.server';
import type { paths } from './access/schema.gen';

const NOW = Date.parse('2026-10-02T07:00:00Z');
const DAY = 86_400_000;

/** An unsigned token with these realm roles; the mock reads its claims without checking it. */
function token(roles: string[]) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ realm_access: { roles } })}.`;
}

function client(roles = ['declarant'], fetch: typeof mockAccessFetch = mockAccessFetch) {
  return createClient<paths>({
    baseUrl: 'http://access.test',
    fetch,
    headers: { authorization: `Bearer ${token(roles)}` },
  });
}

const answer = (status: number, body: unknown) => () =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/problem+json' },
    }),
  );

const down = () => Promise.reject(new TypeError('fetch failed'));

const key = () => crypto.randomUUID();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  setAccessMockLatency(0);
  resetAccessMocks(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('listNotices', () => {
  it('lists the requests about the declarant, latest notified first', async () => {
    const result = await listNotices(client());
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.notices.map((notice) => notice.requestId)).toEqual([
      IDS.awaiting,
      IDS.inWriting,
      IDS.closing,
      IDS.closedNone,
      IDS.closedObjected,
      IDS.partial,
      IDS.denied,
      IDS.granted,
      IDS.withdrawn,
    ]);
  });

  it('reads someone the service does not know as a declarant as having no requests', async () => {
    expect(await listNotices(client(['applicant']))).toEqual({ status: 'ok', notices: [] });
    expect(await listNotices(client(['declarant'], answer(404, { status: 404 })))).toEqual({
      status: 'ok',
      notices: [],
    });
  });

  it('is unavailable when the service is down or fails', async () => {
    failNextAccessCall();
    expect(await listNotices(client())).toEqual({ status: 'unavailable' });
    expect(await listNotices(client(['declarant'], down))).toEqual({ status: 'unavailable' });
  });
});

describe('loadNotice', () => {
  it('picks the request out of the list, or says it is not about the declarant', async () => {
    const found = await loadNotice(client(), IDS.partial);
    expect(found.status === 'ok' && found.notice.decision?.outcome).toBe('partial-grant');
    expect(await loadNotice(client(), crypto.randomUUID())).toEqual({ status: 'not-found' });
  });
});

describe('saveRepresentations (S4)', () => {
  it('saves within the window and keeps the first sent time when edited', async () => {
    const first = await saveRepresentations(
      client(),
      IDS.awaiting,
      { stance: 'object', text: '  The plot is in court.  ', attachments: [] },
      key(),
    );
    if (first.status !== 'saved') throw new Error(first.status);
    expect(first.notice.representations).toMatchObject({
      stance: 'object',
      text: 'The plot is in court.',
    });
    expect(first.notice.canRespond).toBe(true);

    const edited = await saveRepresentations(
      client(),
      IDS.awaiting,
      { stance: 'context', text: 'More context.', attachments: [] },
      key(),
    );
    if (edited.status !== 'saved') throw new Error(edited.status);
    expect(edited.notice.representations?.submittedAt).toBe(
      first.notice.representations?.submittedAt,
    );
  });

  it('closes the window on consent: the request goes under decision', async () => {
    const result = await saveRepresentations(
      client(),
      IDS.awaiting,
      { stance: 'consent', text: '', attachments: [] },
      key(),
    );
    if (result.status !== 'saved') throw new Error(result.status);
    expect(result.notice).toMatchObject({ status: 'under-decision', canRespond: false });
    const again = await saveRepresentations(
      client(),
      IDS.awaiting,
      { stance: 'object', text: 'Changed my mind.', attachments: [] },
      key(),
    );
    expect(again).toEqual({ status: 'closed' });
  });

  it('saves as of when the mock was seeded, not the wall clock', async () => {
    // Seeded as of NOW, but run a month later: every seeded window has closed by the wall clock.
    vi.setSystemTime(NOW + 30 * DAY);
    resetAccessMocks(NOW);
    const saved = await saveRepresentations(
      client(),
      IDS.awaiting,
      { stance: 'object', text: 'The plot is in court.', attachments: [] },
      key(),
    );
    if (saved.status !== 'saved') throw new Error(saved.status);
    expect(saved.notice.representations).toMatchObject({
      submittedAt: '2026-10-02T07:00:00.000Z',
      updatedAt: '2026-10-02T07:00:00.000Z',
    });
  });

  it('replays the first answer for a retried key', async () => {
    const retry = key();
    const body = { stance: 'object' as const, text: 'Once.', attachments: [] };
    const first = await saveRepresentations(client(), IDS.awaiting, body, retry);
    const replay = await saveRepresentations(client(), IDS.awaiting, body, retry);
    expect(replay).toEqual(first);
  });

  it('reads 409 as the window closed, 400 at an attachment, 404 and a failure', async () => {
    expect(
      await saveRepresentations(
        client(),
        IDS.closing,
        { stance: 'object', text: 'Too late.', attachments: [] },
        key(),
      ),
    ).toEqual({ status: 'closed' });
    expect(
      await saveRepresentations(
        client(['declarant'], answer(400, { errors: [{ path: 'attachments.0', message: 'x' }] })),
        IDS.awaiting,
        { stance: 'object', text: 'x', attachments: [crypto.randomUUID()] },
        key(),
      ),
    ).toEqual({ status: 'invalid', attachment: true });
    expect(
      await saveRepresentations(
        client(),
        IDS.awaiting,
        { stance: 'object', text: ' ', attachments: [] },
        key(),
      ),
    ).toEqual({ status: 'invalid', attachment: false });
    expect(
      await saveRepresentations(
        client(),
        crypto.randomUUID(),
        { stance: 'object', text: 'x', attachments: [] },
        key(),
      ),
    ).toEqual({ status: 'not-found' });
    expect(
      await saveRepresentations(
        client(),
        IDS.awaiting,
        { stance: 'object', text: 'Unavailable', attachments: [] },
        key(),
      ),
    ).toEqual({ status: 'unavailable' });
    expect(
      await saveRepresentations(
        client(['declarant'], down),
        IDS.awaiting,
        { stance: 'object', text: 'x', attachments: [] },
        key(),
      ),
    ).toEqual({ status: 'unavailable' });
  });
});
