import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Bff,
  type BffOptions,
  hasFreshStepUp,
  STEP_UP_CODE_MAX_AGE_SECONDS,
  STEP_UP_SUBMIT_MARGIN_SECONDS,
  STEP_UP_WINDOW_SECONDS,
} from './bff.ts';
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
    claims: {
      sub: 'user-1',
      name: 'Wanjiku Kamau',
      preferred_username: 'declarant',
      acr: 'step-up',
      auth_time: 999,
    },
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
      acr: 'step-up',
      authTime: 999,
    });
  });

  it('reports absent acr and auth_time claims as null', async () => {
    provider.exchangeCode.mockResolvedValueOnce(tokens({ claims: { sub: 'user-1' } }));

    const session = await bff.getSession(
      new Request(APP_URL, { headers: { cookie: await signIn() } }),
    );

    expect(session).toMatchObject({ acr: null, authTime: null });
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

  describe('step-up (S17)', () => {
    async function stepUp(cookie: string, returnTo: string) {
      const start = await bff.stepUp(
        new Request(`${APP_URL}/auth/step-up?returnTo=${encodeURIComponent(returnTo)}`, {
          headers: { cookie },
        }),
      );
      const loginCookie = cookieFrom(start, `${COOKIE}_login`);
      const callback = (query = 'code=def&state=s') =>
        bff.callback(
          new Request(`${APP_URL}/auth/callback?${query}`, {
            headers: { cookie: `${cookie}; ${loginCookie}` },
          }),
        );
      return { start, callback };
    }

    it('asks Keycloak for the step-up ACR, which a plain sign-in leaves to the client default', async () => {
      const cookie = await signIn();

      const { start } = await stepUp(cookie, '/declarations/d-1/summary');

      expect(start.status).toBe(302);
      expect(start.headers.get('location')).toMatch(/^http:\/\/keycloak\.test\/auth/);
      const [signInParams, stepUpParams] = provider.authorizationUrl.mock.calls.map(([p]) => p);
      expect(signInParams?.acrValues).toBeUndefined();
      expect(stepUpParams).toMatchObject({
        redirectUri: `${APP_URL}/auth/callback`,
        acrValues: 'step-up',
      });
      expect(stepUpParams?.codeChallenge).toMatch(/^[\w-]{43}$/);
    });

    it('stores the new acr and auth_time and returns with stepUp=done', async () => {
      const cookie = await signIn();
      provider.exchangeCode.mockResolvedValueOnce(
        tokens({
          accessToken: 'access-stepped-up',
          claims: { sub: 'user-1', name: 'Wanjiku Kamau', acr: 'step-up', auth_time: 1_900 },
        }),
      );
      const { callback } = await stepUp(cookie, '/declarations/d-1/summary?stepUp=done');

      const response = await callback();

      expect(response.headers.get('location')).toBe(
        `${APP_URL}/declarations/d-1/summary?stepUp=done`,
      );
      const stepped = cookieFrom(response, COOKIE);
      expect(stepped).not.toBe(cookie);
      expect(
        await bff.getSession(new Request(APP_URL, { headers: { cookie: stepped } })),
      ).toMatchObject({ accessToken: 'access-stepped-up', acr: 'step-up', authTime: 1_900 });
      // The session it replaced is over.
      expect(await bff.getSession(new Request(APP_URL, { headers: { cookie } }))).toBeNull();
    });

    it('returns with stepUp=failed when Keycloak refuses', async () => {
      const cookie = await signIn();
      const { callback } = await stepUp(cookie, '/declarations/d-1/summary');

      const response = await callback('error=access_denied&state=s');

      expect(response.headers.get('location')).toBe(
        `${APP_URL}/declarations/d-1/summary?stepUp=failed`,
      );
      expect(provider.exchangeCode).toHaveBeenCalledTimes(1);
      // The declarant stays signed in as before.
      expect(await bff.getSession(new Request(APP_URL, { headers: { cookie } }))).toMatchObject({
        accessToken: 'access-1',
      });
    });

    it('returns with stepUp=failed when the token does not carry the step-up ACR', async () => {
      const cookie = await signIn();
      provider.exchangeCode.mockResolvedValueOnce(
        tokens({ claims: { sub: 'user-1', acr: '1', auth_time: 1_900 } }),
      );
      const { callback } = await stepUp(cookie, '/declarations/d-1/summary?stepUp=done');

      const response = await callback();

      expect(response.headers.get('location')).toBe(
        `${APP_URL}/declarations/d-1/summary?stepUp=failed`,
      );
    });

    it('returns with stepUp=failed when the code exchange fails', async () => {
      const cookie = await signIn();
      provider.exchangeCode.mockRejectedValueOnce(new Error('invalid_grant'));
      const { callback } = await stepUp(cookie, '/declarations/d-1/summary');

      const response = await callback();

      expect(response.headers.get('location')).toBe(
        `${APP_URL}/declarations/d-1/summary?stepUp=failed`,
      );
    });

    it('never returns off-site', async () => {
      const cookie = await signIn();
      const { callback } = await stepUp(cookie, 'https://evil.example/');

      const response = await callback();

      expect(response.headers.get('location')).toBe(`${APP_URL}/?stepUp=done`);
    });

    it('keeps acr and auth_time across a refresh that does not report them', async () => {
      const cookie = await signIn();
      now += 290_000;
      provider.refresh.mockResolvedValueOnce(
        tokens({ accessToken: 'access-2', claims: { sub: 'user-1' } }),
      );

      expect(await bff.getSession(new Request(APP_URL, { headers: { cookie } }))).toMatchObject({
        accessToken: 'access-2',
        acr: 'step-up',
        authTime: 999,
      });
    });

    it('counts a step-up as fresh for the code max age only', () => {
      const authTime = 2_000;
      const at = (seconds: number) => (authTime + seconds) * 1000;

      expect(hasFreshStepUp({ acr: 'step-up', authTime }, at(STEP_UP_CODE_MAX_AGE_SECONDS))).toBe(
        true,
      );
      expect(
        hasFreshStepUp({ acr: 'step-up', authTime }, at(STEP_UP_CODE_MAX_AGE_SECONDS + 1)),
      ).toBe(false);
      expect(hasFreshStepUp({ acr: '1', authTime }, at(0))).toBe(false);
      expect(hasFreshStepUp({ acr: 'step-up', authTime: null }, at(0))).toBe(false);
    });

    it('lapses the code well before the window services accept, so a silent step-up leaves time to submit', () => {
      // Keycloak is silent on a step-up while the code is within its max age and returns the
      // old auth_time: the last silent answer must still leave the margin to affirm and submit.
      expect(STEP_UP_WINDOW_SECONDS).toBe(300);
      expect(STEP_UP_WINDOW_SECONDS - STEP_UP_CODE_MAX_AGE_SECONDS).toBeGreaterThanOrEqual(
        STEP_UP_SUBMIT_MARGIN_SECONDS,
      );
      expect(STEP_UP_SUBMIT_MARGIN_SECONDS).toBeGreaterThanOrEqual(120);
    });
  });

  describe('demo mode (#616)', () => {
    it('signs in afresh: ends the session and sends the parameters to Keycloak', async () => {
      const cookie = await signIn();

      const response = await bff.signInAfresh(
        new Request(`${APP_URL}/auth/demo-switch`, { method: 'POST', headers: { cookie } }),
        { authorizeParams: { demo_ticket: 'v1.ticket' }, returnTo: '/review' },
      );

      expect(response.status).toBe(302);
      expect(provider.authorizationUrl.mock.calls.at(-1)?.[0].extraParams).toEqual({
        demo_ticket: 'v1.ticket',
      });
      expect(response.headers.getSetCookie()).toContainEqual(
        expect.stringMatching(/^adili_portal=;/),
      );
      expect(await bff.getSession(new Request(APP_URL, { headers: { cookie } }))).toBeNull();

      const callback = await bff.callback(
        new Request(`${APP_URL}/auth/callback?code=abc&state=s`, {
          headers: { cookie: cookieFrom(response, `${COOKIE}_login`) },
        }),
      );
      expect(callback.headers.get('location')).toBe(`${APP_URL}/review`);
    });

    it('asks the hook for parameters on sign-in and step-up', async () => {
      const authorizeParams = vi.fn<NonNullable<BffOptions['authorizeParams']>>((_, kind) =>
        Promise.resolve(kind === 'step-up' ? { demo_ticket: 'v1.step-up' } : undefined),
      );
      bff = new Bff({
        appUrl: APP_URL,
        cookieName: COOKIE,
        provider,
        store: new MemorySessionStore(() => now),
        now: () => now,
        authorizeParams,
      });

      await bff.login(new Request(`${APP_URL}/auth/login`));
      await bff.stepUp(new Request(`${APP_URL}/auth/step-up`));

      expect(authorizeParams.mock.calls.map(([, kind]) => kind)).toEqual(['login', 'step-up']);
      expect(provider.authorizationUrl.mock.calls[0]?.[0].extraParams).toBeUndefined();
      expect(provider.authorizationUrl.mock.calls[1]?.[0].extraParams).toEqual({
        demo_ticket: 'v1.step-up',
      });
    });

    it('revalidates tokens older than revalidateAfterMs, ending a session Keycloak ended', async () => {
      bff = new Bff({
        appUrl: APP_URL,
        cookieName: COOKIE,
        provider,
        store: new MemorySessionStore(() => now),
        now: () => now,
        revalidateAfterMs: 3000,
      });
      const cookie = await signIn();
      const request = () => new Request(APP_URL, { headers: { cookie } });

      now += 2000;
      expect((await bff.getSession(request()))?.accessToken).toBe('access-1');
      expect(provider.refresh).not.toHaveBeenCalled();

      now += 1000;
      provider.refresh.mockRejectedValueOnce(new Error('invalid_grant'));
      expect(await bff.getSession(request())).toBeNull();
    });
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
