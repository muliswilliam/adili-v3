import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  createServiceClient,
  SERVICE_CALL_TIMEOUT_MS,
  ServiceCallFailed,
  type ServiceClientOptions,
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
        404: { content: { 'application/problem+json': { status: number } } };
      };
    };
  };
}

/** The caller's own "unavailable" error. */
class ThingsUnavailable extends Error {}

const thingSchema = z.object({ id: z.string() });

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

function recordingFetch(statuses: number[], body: (status: number) => unknown = defaultBody) {
  const seen: Seen[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const request = input as Request;
    seen.push({
      authorization: request.headers.get('authorization'),
      body: await request.text(),
      url: request.url,
    });
    const status = statuses.shift() ?? 201;
    return new Response(JSON.stringify(body(status)), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetch, seen };
}

function defaultBody(status: number): unknown {
  return status === 201 ? { id: 'thing-1' } : { status };
}

function things(options: Partial<ServiceClientOptions> = {}) {
  return createServiceClient<paths>({
    baseUrl: 'http://things.test',
    service: 'things',
    tokens: tokenSource(),
    unavailable: (message, options) => new ThingsUnavailable(message, options),
    ...options,
  });
}

const createThing = { status: 201, schema: thingSchema };

describe('createServiceClient', () => {
  it("calls with the service's token under the base URL and returns the validated answer", async () => {
    const { fetch, seen } = recordingFetch([201]);
    const client = things({ baseUrl: 'http://things.test/', fetch });

    const thing = await client.call(
      (api) => api.POST('/internal/v1/things', { body: { name: 'a' } }),
      createThing,
    );

    expect(thing).toEqual({ id: 'thing-1' });
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
    const client = things({ tokens, fetch });

    const thing = await client.call(
      (api) => api.POST('/internal/v1/things', { body: { name: 'a' } }),
      createThing,
    );

    expect(thing).toEqual({ id: 'thing-1' });
    expect(tokens.invalidations).toBe(1);
    expect(seen.map(({ authorization, body }) => [authorization, body])).toEqual([
      ['Bearer t1', '{"name":"a"}'],
      ['Bearer t2', '{"name":"a"}'],
    ]);
  });

  it('answers a status the caller gave a meaning with its handler', async () => {
    const client = things({ fetch: recordingFetch([404]).fetch });

    const thing = await client.call(
      (api) => api.POST('/internal/v1/things', { body: { name: 'a' } }),
      { ...createThing, otherwise: { 404: () => null } },
    );

    expect(thing).toBeNull();
  });

  it("lets a handler's own error through", async () => {
    class NoSuchThing extends Error {}
    const client = things({ fetch: recordingFetch([404]).fetch });

    const call = client.call((api) => api.POST('/internal/v1/things', { body: { name: 'a' } }), {
      ...createThing,
      otherwise: {
        404: () => {
          throw new NoSuchThing();
        },
      },
    });

    await expect(call).rejects.toBeInstanceOf(NoSuchThing);
  });

  it.each<[string, ServiceClientOptions['fetch'], RegExp]>([
    ['another status', recordingFetch([503]).fetch, /^The things service answered 503$/],
    ['a second 401', recordingFetch([401, 401]).fetch, /^The things service answered 401$/],
    [
      'a body that breaks the contract',
      recordingFetch([201], () => ({ id: 7 })).fetch,
      /^The things service answered a body that breaks its contract$/,
    ],
    [
      'a success whose body is not JSON',
      () => Promise.resolve(new Response('<html>proxy error</html>', { status: 201 })),
      /^The things service did not answer$/,
    ],
    [
      'no connection',
      () => Promise.reject(new TypeError('fetch failed')),
      /^The things service did not answer$/,
    ],
  ])("maps %s to the caller's unavailable error", async (_case, fetch, message) => {
    const call = things({ fetch }).call(
      (api) => api.POST('/internal/v1/things', { body: { name: 'a' } }),
      createThing,
    );

    await expect(call).rejects.toBeInstanceOf(ThingsUnavailable);
    await expect(call).rejects.toThrow(message);
  });

  it('maps no token to unavailable, with the reason as its cause', async () => {
    const { fetch, seen } = recordingFetch([201]);
    const client = things({
      tokens: {
        token: () => Promise.reject(new ServiceTokenError('Keycloak unreachable')),
        invalidate: () => undefined,
      },
      fetch,
    });

    const failure = await client
      .call((api) => api.POST('/internal/v1/things', { body: { name: 'a' } }), createThing)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ThingsUnavailable);
    expect((failure as Error).cause).toBeInstanceOf(ServiceCallFailed);
    expect(((failure as Error).cause as Error).message).toBe(
      'Service call failed: no service token',
    );
    expect(seen).toEqual([]);
  });

  it('gives up after the timeout, 2 s unless configured', async () => {
    expect(SERVICE_CALL_TIMEOUT_MS).toBe(2_000);
    const hanging = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error('no deadline given to fetch');
        signal.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
      })) as typeof globalThis.fetch;
    const client = things({ timeoutMs: 20, fetch: hanging });

    const started = performance.now();
    const call = client.call(
      (api) => api.POST('/internal/v1/things', { body: { name: 'a' } }),
      createThing,
    );

    await expect(call).rejects.toBeInstanceOf(ThingsUnavailable);
    // Well before the default: the configured timeout applied (with room for a loaded machine).
    expect(performance.now() - started).toBeLessThan(SERVICE_CALL_TIMEOUT_MS);
  });

  it('lets any other error (a bug) through', async () => {
    const bug = new TypeError('x is undefined');
    const call = things({ fetch: recordingFetch([201]).fetch }).call(() => {
      throw bug;
    }, createThing);

    await expect(call).rejects.toBe(bug);
  });
});
