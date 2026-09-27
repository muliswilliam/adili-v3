import { describe, expect, it } from 'vitest';

import { ServiceTokenClient, ServiceTokenError } from '../src/auth/service-token-client.js';

interface Call {
  url: string;
  form: URLSearchParams;
}

/** A token endpoint that issues `token-1`, `token-2`, ... valid for `expiresIn` seconds. */
function tokenEndpoint(expiresIn = 300) {
  const calls: Call[] = [];
  let release: (() => void) | undefined;
  const state = { hold: false };
  const fetchFake: typeof fetch = async (input, init) => {
    calls.push({ url: input as string, form: init?.body as URLSearchParams });
    if (state.hold) await new Promise<void>((resolve) => (release = resolve));
    return Response.json({ access_token: `token-${calls.length}`, expires_in: expiresIn });
  };
  return { calls, fetch: fetchFake, state, release: () => release?.() };
}

function client(endpoint: ReturnType<typeof tokenEndpoint>, clock: { now: number }) {
  return new ServiceTokenClient({
    issuerUrl: 'http://keycloak.test/realms/adili/',
    clientId: 'directory',
    clientSecret: 'directory-dev-secret',
    scopes: ['documents:internal'],
    fetch: endpoint.fetch,
    now: () => clock.now,
  });
}

describe('ServiceTokenClient', () => {
  it('exchanges client credentials at the realm token endpoint', async () => {
    const endpoint = tokenEndpoint();

    expect(await client(endpoint, { now: 0 }).token()).toBe('token-1');

    expect(endpoint.calls).toHaveLength(1);
    expect(endpoint.calls[0]?.url).toBe(
      'http://keycloak.test/realms/adili/protocol/openid-connect/token',
    );
    expect(Object.fromEntries(endpoint.calls[0]?.form ?? [])).toEqual({
      grant_type: 'client_credentials',
      client_id: 'directory',
      client_secret: 'directory-dev-secret',
      scope: 'documents:internal',
    });
  });

  it('reuses the token until 30 seconds before it expires', async () => {
    const endpoint = tokenEndpoint(300);
    const clock = { now: 0 };
    const tokens = client(endpoint, clock);
    await tokens.token();

    clock.now = 269_999;
    expect(await tokens.token()).toBe('token-1');
    clock.now = 270_000;
    expect(await tokens.token()).toBe('token-2');
    expect(endpoint.calls).toHaveLength(2);
  });

  it('shares one request between concurrent callers', async () => {
    const endpoint = tokenEndpoint();
    endpoint.state.hold = true;
    const tokens = client(endpoint, { now: 0 });

    const waiting = Promise.all([tokens.token(), tokens.token(), tokens.token()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    endpoint.release();

    expect(await waiting).toEqual(['token-1', 'token-1', 'token-1']);
    expect(endpoint.calls).toHaveLength(1);
  });

  it('fetches a new token after invalidate', async () => {
    const endpoint = tokenEndpoint();
    const tokens = client(endpoint, { now: 0 });
    await tokens.token();

    tokens.invalidate();

    expect(await tokens.token()).toBe('token-2');
  });

  it('throws ServiceTokenError with the status when the credentials are refused, and retries next time', async () => {
    let refuse = true;
    const tokens = new ServiceTokenClient({
      issuerUrl: 'http://keycloak.test/realms/adili',
      clientId: 'directory',
      clientSecret: 'wrong',
      fetch: () =>
        Promise.resolve(
          refuse
            ? Response.json({ error: 'unauthorized_client' }, { status: 401 })
            : Response.json({ access_token: 'token', expires_in: 60 }),
        ),
    });

    const error: unknown = await tokens.token().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServiceTokenError);
    expect((error as ServiceTokenError).status).toBe(401);
    expect((error as ServiceTokenError).message).toContain('unauthorized_client');

    refuse = false;
    expect(await tokens.token()).toBe('token');
  });

  it('throws ServiceTokenError when the endpoint is unreachable', async () => {
    const tokens = new ServiceTokenClient({
      issuerUrl: 'http://keycloak.test/realms/adili',
      clientId: 'directory',
      clientSecret: 'secret',
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });

    await expect(tokens.token()).rejects.toMatchObject({
      name: 'ServiceTokenError',
      status: undefined,
    });
  });
});
