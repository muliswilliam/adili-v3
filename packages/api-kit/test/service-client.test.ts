import { describe, expect, it } from 'vitest';

import {
  createServiceClient,
  isUnanswered,
  SERVICE_CALL_TIMEOUT_MS,
  ServiceCallFailed,
  ServiceTokenError,
} from '../src/index.js';

/** A contract of one internal route, as `openapi-typescript` generates it. */
interface paths {
  '/internal/v1/things': {
    post: {
      requestBody: { content: { 'application/json': { name: string } } };
      responses: {
        201: { content: { 'application/json': { id: string } } };
        401: { content: { 'application/problem+json': { status: number } } };
      };
    };
  };
}

interface Seen {
  authorization: string | null;
  body: string;
  url: string;
}

/** Tokens `t1`, `t2`, ...: a fresh one after each `invalidate`. */
function tokenSource() {
  let issued = 1;
  return {
    invalidations: 0,
    token() {
      return Promise.resolve(`t${issued}`);
    },
    invalidate() {
      this.invalidations += 1;
      issued += 1;
    },
  };
}

function recordingFetch(statuses: number[]) {
  const seen: Seen[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const request = input as Request;
    seen.push({
      authorization: request.headers.get('authorization'),
      body: await request.text(),
      url: request.url,
    });
    const status = statuses.shift() ?? 201;
    return new Response(JSON.stringify(status === 201 ? { id: 'thing-1' } : { status }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetch, seen };
}

describe('createServiceClient', () => {
  it("calls with the service's token under the base URL", async () => {
    const { fetch, seen } = recordingFetch([201]);
    const client = createServiceClient<paths>({
      baseUrl: 'http://things.test/',
      tokens: tokenSource(),
      fetch,
    });

    const { data } = await client.POST('/internal/v1/things', { body: { name: 'a' } });

    expect(data).toEqual({ id: 'thing-1' });
    expect(seen).toEqual([
      {
        authorization: 'Bearer t1',
        body: '{"name":"a"}',
        url: 'http://things.test/internal/v1/things',
      },
    ]);
  });

  it('retries once with a fresh token after a 401, sending the body again', async () => {
    const tokens = tokenSource();
    const { fetch, seen } = recordingFetch([401, 201]);
    const client = createServiceClient<paths>({ baseUrl: 'http://things.test', tokens, fetch });

    const { data, response } = await client.POST('/internal/v1/things', { body: { name: 'a' } });

    expect(response.status).toBe(201);
    expect(data).toEqual({ id: 'thing-1' });
    expect(tokens.invalidations).toBe(1);
    expect(seen.map(({ authorization, body }) => [authorization, body])).toEqual([
      ['Bearer t1', '{"name":"a"}'],
      ['Bearer t2', '{"name":"a"}'],
    ]);
  });

  it('answers a second 401 as it is, without retrying again', async () => {
    const { fetch, seen } = recordingFetch([401, 401, 201]);
    const client = createServiceClient<paths>({
      baseUrl: 'http://things.test',
      tokens: tokenSource(),
      fetch,
    });

    const { response } = await client.POST('/internal/v1/things', { body: { name: 'a' } });

    expect(response.status).toBe(401);
    expect(seen).toHaveLength(2);
  });

  it('gives up after the timeout, 2 s unless configured', async () => {
    expect(SERVICE_CALL_TIMEOUT_MS).toBe(2_000);
    const hanging = ((input: string | URL | Request) =>
      new Promise<Response>((_resolve, reject) => {
        const { signal } = input as Request;
        signal.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
      })) as typeof globalThis.fetch;
    const client = createServiceClient<paths>({
      baseUrl: 'http://things.test',
      tokens: tokenSource(),
      timeoutMs: 20,
      fetch: hanging,
    });

    const started = performance.now();
    const call = client.POST('/internal/v1/things', { body: { name: 'a' } });

    await expect(call).rejects.toBeInstanceOf(ServiceCallFailed);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('fails the call without a token or a connection', async () => {
    const noToken = createServiceClient<paths>({
      baseUrl: 'http://things.test',
      tokens: {
        token: () => Promise.reject(new ServiceTokenError('Keycloak unreachable')),
        invalidate: () => undefined,
      },
      fetch: recordingFetch([201]).fetch,
    });
    const unreachable = createServiceClient<paths>({
      baseUrl: 'http://things.test',
      tokens: tokenSource(),
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });

    await expect(
      noToken.POST('/internal/v1/things', { body: { name: 'a' } }),
    ).rejects.toBeInstanceOf(ServiceCallFailed);
    await expect(unreachable.POST('/internal/v1/things', { body: { name: 'a' } })).rejects.toThrow(
      'Service call failed: POST /internal/v1/things unanswered',
    );
  });
});

describe('isUnanswered', () => {
  it('is true for no answer and a body that is not JSON, not for other errors', async () => {
    const html = createServiceClient<paths>({
      baseUrl: 'http://things.test',
      tokens: tokenSource(),
      fetch: () => Promise.resolve(new Response('<html>proxy error</html>', { status: 201 })),
    });
    const failure = await html
      .POST('/internal/v1/things', { body: { name: 'a' } })
      .catch((error: unknown) => error);

    expect(isUnanswered(failure)).toBe(true);
    expect(isUnanswered(new ServiceCallFailed('no service token'))).toBe(true);
    expect(isUnanswered(new TypeError('x is undefined'))).toBe(false);
  });
});
