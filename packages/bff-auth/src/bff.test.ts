import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Bff } from './bff.ts';
import type { OidcProvider, TokenSet } from './oidc-provider.ts';
import { MemorySessionStore } from './session-store.ts';

const APP_URL = 'http://localhost:3010';
const COOKIE = 'adili_portal';

function tokens(overrides: Partial<TokenSet> = {}): TokenSet {
  return {
    accessToken: 'access-1',
    expiresInSeconds: 300,
    refreshToken: 'refresh-1',
    refreshExpiresInSeconds: 1800,
    idToken: 'id-1',
    claims: { sub: 'user-1', name: 'Wanjiku Kamau', preferred_username: 'declarant' },
    ...overrides,
  };
}

/** Cookie header value for the named cookie from a response's Set-Cookie headers. */
function cookieFrom(response: Response, name: string): string {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (!cookie) throw new Error(`no ${name} cookie set`);
  return cookie.split(';')[0] ?? '';
}

describe('Bff', () => {
  let now: number;
  let provider: {
    [K in keyof OidcProvider]: ReturnType<typeof vi.fn<OidcProvider[K]>>;
  };
  let bff: Bff;

  beforeEach(() => {
    now = 1_000_000;
    provider = {
      authorizationUrl: vi.fn<OidcProvider['authorizationUrl']>(({ state }) =>
        Promise.resolve(new URL(`http://keycloak.test/auth?state=${state}`)),
      ),
      exchangeCode: vi.fn<OidcProvider['exchangeCode']>(() => Promise.resolve(tokens())),
      refresh: vi.fn<OidcProvider['refresh']>(() =>
        Promise.resolve(tokens({ accessToken: 'access-2', refreshToken: 'refresh-2' })),
      ),
      endSessionUrl: vi.fn<OidcProvider['endSessionUrl']>(() =>
        Promise.resolve(new URL('http://keycloak.test/logout')),
      ),
    };
    bff = new Bff({
      appUrl: APP_URL,
      cookieName: COOKIE,
      provider,
      store: new MemorySessionStore(() => now),
      now: () => now,
    });
  });

  async function signIn(returnTo = '/declarations'): Promise<string> {
    const login = await bff.login(new Request(`${APP_URL}/auth/login?returnTo=${returnTo}`));
    const loginCookie = cookieFrom(login, `${COOKIE}_login`);
    const callback = await bff.callback(
      new Request(`${APP_URL}/auth/callback?code=abc&state=s`, {
        headers: { cookie: loginCookie },
      }),
    );
    return cookieFrom(callback, COOKIE);
  }

  it('starts login with PKCE and a login cookie scoped to /auth', async () => {
    const response = await bff.login(new Request(`${APP_URL}/auth/login`));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toMatch(/^http:\/\/keycloak\.test\/auth/);
    const [params] = provider.authorizationUrl.mock.calls[0] ?? [];
    expect(params?.redirectUri).toBe(`${APP_URL}/auth/callback`);
    expect(params?.codeChallenge).toMatch(/^[\w-]{43}$/);
    const cookie = response.headers.getSetCookie()[0] ?? '';
    expect(cookie).toContain('Path=/auth');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
  });

  it('opens a session on callback and returns to the requested page', async () => {
    const login = await bff.login(new Request(`${APP_URL}/auth/login?returnTo=/declarations`));
    const callback = await bff.callback(
      new Request(`${APP_URL}/auth/callback?code=abc&state=s`, {
        headers: { cookie: cookieFrom(login, `${COOKIE}_login`) },
      }),
    );

    expect(callback.headers.get('location')).toBe(`${APP_URL}/declarations`);
    const [callbackUrl, checks] = provider.exchangeCode.mock.calls[0] ?? [];
    expect(callbackUrl?.toString()).toBe(`${APP_URL}/auth/callback?code=abc&state=s`);
    expect(checks?.codeVerifier).toMatch(/^[\w-]{43}$/);

    const session = await bff.getSession(
      new Request(APP_URL, { headers: { cookie: cookieFrom(callback, COOKIE) } }),
    );
    expect(session).toEqual({
      accessToken: 'access-1',
      user: { subject: 'user-1', name: 'Wanjiku Kamau', username: 'declarant' },
    });
  });

  it('refuses to reuse a login transaction', async () => {
    const login = await bff.login(new Request(`${APP_URL}/auth/login`));
    const request = () =>
      new Request(`${APP_URL}/auth/callback?code=abc`, {
        headers: { cookie: cookieFrom(login, `${COOKIE}_login`) },
      });
    await bff.callback(request());

    const replay = await bff.callback(request());

    expect(replay.headers.get('location')).toBe(`${APP_URL}/?auth_error=login_expired`);
  });

  it('reports provider errors on the landing page', async () => {
    const response = await bff.callback(
      new Request(`${APP_URL}/auth/callback?error=access_denied`),
    );

    expect(response.headers.get('location')).toBe(`${APP_URL}/?auth_error=access_denied`);
    expect(provider.exchangeCode).not.toHaveBeenCalled();
  });

  it('refreshes an expiring access token once for concurrent requests', async () => {
    const cookie = await signIn();
    now += 290_000;
    const request = () => new Request(APP_URL, { headers: { cookie } });

    const [first, second] = await Promise.all([
      bff.getSession(request()),
      bff.getSession(request()),
    ]);

    expect(provider.refresh).toHaveBeenCalledTimes(1);
    expect(provider.refresh).toHaveBeenCalledWith('refresh-1');
    expect(first?.accessToken).toBe('access-2');
    expect(second?.accessToken).toBe('access-2');
  });

  it('ends the session when the refresh token is rejected', async () => {
    const cookie = await signIn();
    now += 290_000;
    provider.refresh.mockRejectedValueOnce(new Error('invalid_grant'));

    expect(await bff.getSession(new Request(APP_URL, { headers: { cookie } }))).toBeNull();
    expect(await bff.getSession(new Request(APP_URL, { headers: { cookie } }))).toBeNull();
  });

  it('logs out locally and at Keycloak', async () => {
    const cookie = await signIn();

    const response = await bff.logout(
      new Request(`${APP_URL}/auth/logout`, {
        method: 'POST',
        headers: { cookie, origin: APP_URL },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://keycloak.test/logout');
    expect(provider.endSessionUrl).toHaveBeenCalledWith({
      idTokenHint: 'id-1',
      postLogoutRedirectUri: `${APP_URL}/`,
    });
    expect(response.headers.getSetCookie()[0]).toContain('Max-Age=0');
    expect(await bff.getSession(new Request(APP_URL, { headers: { cookie } }))).toBeNull();
  });

  it('refuses cross-origin logout', async () => {
    const response = await bff.logout(
      new Request(`${APP_URL}/auth/logout`, {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      }),
    );

    expect(response.status).toBe(403);
  });

  it('marks cookies Secure on HTTPS origins', async () => {
    const secureBff = new Bff({
      appUrl: 'https://portal.adili.go.ke',
      cookieName: COOKIE,
      provider,
      store: new MemorySessionStore(),
    });

    const response = await secureBff.login(new Request('https://portal.adili.go.ke/auth/login'));

    expect(response.headers.getSetCookie()[0]).toContain('Secure');
  });
});
