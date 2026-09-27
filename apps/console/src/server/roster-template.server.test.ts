import { describe, expect, it } from 'vitest';

import { createDirectoryClient } from './directory/client';
import { type RosterTemplateDeps, rosterTemplateResponse } from './roster-template.server';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function depsAnswering(
  respond: (request: Request) => Response | Promise<Response>,
  accessToken: string | null = 'token-123',
) {
  const requests: Request[] = [];
  const deps: RosterTemplateDeps = {
    accessToken: () => Promise.resolve(accessToken),
    directory: (token) =>
      createDirectoryClient({
        baseUrl: 'http://directory.test',
        accessToken: token,
        fetch: (input) => {
          const request = input instanceof Request ? input : new Request(input);
          requests.push(request);
          return Promise.resolve(respond(request));
        },
      }),
  };
  return { deps, requests };
}

const request = (query: string) => new Request(`http://console.test/roster/template${query}`);

describe('rosterTemplateResponse', () => {
  it("passes the directory's attachment through with the viewer's token", async () => {
    const { deps, requests } = depsAnswering(
      () =>
        new Response(new Uint8Array([0x50, 0x4b, 0x03]), {
          headers: {
            'content-type': XLSX,
            'content-disposition': 'attachment; filename="adili-roster-template.xlsx"',
            'content-length': '3',
            'x-internal': 'not for browsers',
          },
        }),
    );

    const response = await rosterTemplateResponse(request('?format=xlsx'), deps);

    expect(requests[0]?.url).toBe('http://directory.test/v1/roster/template?format=xlsx');
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer token-123');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(XLSX);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="adili-roster-template.xlsx"',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-internal')).toBeNull();
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0x50, 0x4b, 0x03]);
  });

  it("passes the directory's refusal through", async () => {
    const problem = { type: 'about:blank', title: 'Forbidden', status: 403 };
    const { deps } = depsAnswering(
      () =>
        new Response(JSON.stringify(problem), {
          status: 403,
          headers: { 'content-type': 'application/problem+json' },
        }),
    );

    const response = await rosterTemplateResponse(request('?format=csv'), deps);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(problem);
  });

  it('answers 401 without a session and 400 for an unknown format, without calling the directory', async () => {
    const signedOut = depsAnswering(() => new Response('unexpected'), null);
    expect((await rosterTemplateResponse(request('?format=csv'), signedOut.deps)).status).toBe(401);

    const signedIn = depsAnswering(() => new Response('unexpected'));
    expect((await rosterTemplateResponse(request('?format=pdf'), signedIn.deps)).status).toBe(400);
    expect((await rosterTemplateResponse(request(''), signedIn.deps)).status).toBe(400);

    expect([...signedOut.requests, ...signedIn.requests]).toEqual([]);
  });

  it('answers 502 when the directory cannot be reached', async () => {
    const { deps } = depsAnswering(() => Promise.reject(new TypeError('fetch failed')));

    const response = await rosterTemplateResponse(request('?format=csv'), deps);

    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
  });
});
