import { describe, expect, it } from 'vitest';

import { callDirectory, createDirectoryClient } from './client';

function clientAnswering(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const client = createDirectoryClient({
    baseUrl: 'http://directory.test',
    accessToken: 'token-123',
    fetch: (input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return Promise.resolve(respond(request));
    },
  });
  return { client, requests };
}

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

describe('callDirectory', () => {
  it('sends the bearer token and query, and returns the data', async () => {
    const page = { items: [], nextCursor: null, total: 0 };
    const { client, requests } = clientAnswering(() => json(page));

    const result = await callDirectory(() =>
      client.GET('/v1/commissions', { params: { query: { search: 'teach', type: 'hosted' } } }),
    );

    expect(result).toEqual({ ok: true, data: page });
    expect(requests[0]?.url).toBe('http://directory.test/v1/commissions?search=teach&type=hosted');
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer token-123');
  });

  it('returns problem details for 4xx answers', async () => {
    const problem = { type: 'about:blank', title: 'Not Found', status: 404 };
    const { client } = clientAnswering(() => json(problem, 404, 'application/problem+json'));

    const result = await callDirectory(() =>
      client.GET('/v1/commissions/{slug}', { params: { path: { slug: 'tsc' } } }),
    );

    expect(result).toEqual({ ok: false, error: { kind: 'problem', problem } });
  });

  it('synthesises a problem when a 4xx has no problem body', async () => {
    const { client } = clientAnswering(
      () => new Response('nope', { status: 403, statusText: 'Forbidden' }),
    );

    const result = await callDirectory(() => client.GET('/v1/commissions'));

    expect(result).toEqual({
      ok: false,
      error: { kind: 'problem', problem: { type: 'about:blank', title: 'Forbidden', status: 403 } },
    });
  });

  it('treats 401 as signed out', async () => {
    const { client } = clientAnswering(() => new Response(null, { status: 401 }));

    expect(await callDirectory(() => client.GET('/v1/commissions'))).toEqual({
      ok: false,
      error: { kind: 'unauthenticated' },
    });
  });

  it('treats 5xx as unavailable, keeping the problem detail', async () => {
    const { client } = clientAnswering(() =>
      json(
        { type: 'about:blank', title: 'Bad Gateway', status: 502, detail: 'Keycloak down' },
        502,
      ),
    );

    expect(await callDirectory(() => client.GET('/v1/commissions'))).toEqual({
      ok: false,
      error: { kind: 'unavailable', detail: 'Keycloak down' },
    });
  });

  it('treats network failures as unavailable', async () => {
    const { client } = clientAnswering(() => Promise.reject(new TypeError('fetch failed')));

    expect(await callDirectory(() => client.GET('/v1/commissions'))).toEqual({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    });
  });
});
