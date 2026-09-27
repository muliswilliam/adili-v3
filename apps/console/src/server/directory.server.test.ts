import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPrincipal, PRINCIPAL_CACHE_TTL_MS } from './directory.server';

const BASE_URL = 'http://directory.test';
const PRINCIPAL = { subject: 'user-1', tenant: 'tsc', roles: ['reviewer'], clientId: 'console' };

function stubDirectory(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const ok = () => Response.json(PRINCIPAL);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPrincipal', () => {
  it('asks the directory once per token while its answer is fresh', async () => {
    const fetch = stubDirectory(ok(), ok());
    const token = `token-${crypto.randomUUID()}`;
    const now = Date.now();

    const first = await fetchPrincipal(BASE_URL, token, now);
    const again = await fetchPrincipal(BASE_URL, token, now + PRINCIPAL_CACHE_TTL_MS - 1);

    expect(first).toEqual({ ok: true, principal: PRINCIPAL });
    expect(again).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toEqual(new URL('/v1/me', BASE_URL));
  });

  it('asks again once the answer is stale, and for another token', async () => {
    const fetch = stubDirectory(ok(), ok(), ok());
    const token = `token-${crypto.randomUUID()}`;
    const now = Date.now();

    await fetchPrincipal(BASE_URL, token, now);
    await fetchPrincipal(BASE_URL, token, now + PRINCIPAL_CACHE_TTL_MS);
    await fetchPrincipal(BASE_URL, `token-${crypto.randomUUID()}`, now);

    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not keep failures', async () => {
    const fetch = stubDirectory(new Response(null, { status: 503 }), ok());
    const token = `token-${crypto.randomUUID()}`;

    expect(await fetchPrincipal(BASE_URL, token)).toEqual({
      ok: false,
      reason: 'Directory service answered 503',
    });
    expect(await fetchPrincipal(BASE_URL, token)).toEqual({ ok: true, principal: PRINCIPAL });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
