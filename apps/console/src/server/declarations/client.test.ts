import { describe, expect, it } from 'vitest';

import { callDeclarations, createDeclarationsClient } from './client';

function respond(status: number, body: unknown): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
}

describe('createDeclarationsClient', () => {
  it('sends the bearer token and the list filters to the declarations service', async () => {
    const seen: Request[] = [];
    const client = createDeclarationsClient({
      baseUrl: 'http://declarations.test',
      accessToken: 'token-1',
      fetch: (input) => {
        if (input instanceof Request) seen.push(input);
        return respond(200, { items: [], nextCursor: null })(input);
      },
    });
    await client.GET('/v1/commissions/{slug}/obligations', {
      params: { path: { slug: 'psc' }, query: { status: 'overdue', onboarded: 'false' } },
    });
    const request = seen[0];
    expect(request?.url).toBe(
      'http://declarations.test/v1/commissions/psc/obligations?status=overdue&onboarded=false',
    );
    expect(request?.headers.get('authorization')).toBe('Bearer token-1');
  });
});

describe('callDeclarations', () => {
  it('folds a 403 problem into a result the page can switch on', async () => {
    const client = createDeclarationsClient({
      baseUrl: 'http://declarations.test',
      accessToken: 't',
      fetch: respond(403, { type: 'about:blank', title: 'Forbidden', status: 403 }),
    });
    const result = await callDeclarations(() =>
      client.GET('/v1/commissions/{slug}/obligations', { params: { path: { slug: 'psc' } } }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
      },
    });
  });
});
