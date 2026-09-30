import { Bff, MemorySessionStore, type OidcProvider, type Session } from '@adili/bff-auth';
import { describe, expect, it, vi } from 'vitest';

import { Route as CallbackRoute } from '../routes/auth/callback';
import { Route as StepUpRoute } from '../routes/auth/step-up';
import { stepUpStatus } from './step-up.server';

const APP_URL = 'http://localhost:3010';

const provider = {
  authorizationUrl: vi.fn<OidcProvider['authorizationUrl']>(({ state }) =>
    Promise.resolve(new URL(`http://keycloak.test/auth?state=${state}`)),
  ),
  exchangeCode: vi.fn<OidcProvider['exchangeCode']>(() =>
    Promise.resolve({
      accessToken: 'access-stepped-up',
      expiresInSeconds: 300,
      claims: { sub: 'user-1', acr: 'step-up', auth_time: 1_790_000_000 },
    }),
  ),
  refresh: vi.fn<OidcProvider['refresh']>(),
  endSessionUrl: vi.fn<OidcProvider['endSessionUrl']>(),
};
const bff = new Bff({
  appUrl: APP_URL,
  cookieName: 'adili_portal',
  provider,
  store: new MemorySessionStore(),
});
vi.mock('./bff.server', () => ({ getBff: () => bff }));

type Handler = (context: { request: Request }) => Promise<Response>;

/** A server route's GET handler, as TanStack Start calls it. */
function get(route: { options: unknown }): Handler {
  const { server } = route.options as { server: { handlers: { GET: Handler } } };
  return server.handlers.GET;
}

function cookieFrom(response: Response, name: string): string {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (!cookie) throw new Error(`no ${name} cookie set`);
  return cookie.split(';')[0] ?? '';
}

describe('/auth/step-up (S17)', () => {
  it('round-trips through Keycloak back to returnTo with stepUp=done', async () => {
    const summary = '/declarations/0b8e7c1a-3f2d-4e5a-9b6c-7d8e9f0a1b2c/summary';

    const start = await get(StepUpRoute)({
      request: new Request(
        `${APP_URL}/auth/step-up?returnTo=${encodeURIComponent(`${summary}?stepUp=done`)}`,
      ),
    });

    expect(start.status).toBe(302);
    expect(provider.authorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ acrValues: 'step-up' }),
    );
    const back = await get(CallbackRoute)({
      request: new Request(`${APP_URL}/auth/callback?code=abc&state=s`, {
        headers: { cookie: cookieFrom(start, 'adili_portal_login') },
      }),
    });
    expect(back.headers.get('location')).toBe(`${APP_URL}${summary}?stepUp=done`);
    const session = await bff.getSession(
      new Request(APP_URL, { headers: { cookie: cookieFrom(back, 'adili_portal') } }),
    );
    expect(session).toMatchObject({ acr: 'step-up', authTime: 1_790_000_000 });
  });
});

describe('stepUpStatus', () => {
  const session = (acr: string | null, authTime: number | null): Session => ({
    user: { subject: 'user-1', name: 'Wanjiku Kamau' },
    accessToken: 'access',
    acr,
    authTime,
  });
  const authTime = 1_790_000_000;
  const at = (seconds: number) => (authTime + seconds) * 1000;

  it('reports acr and auth_time, fresh within the code max age of three minutes', () => {
    expect(stepUpStatus(session('step-up', authTime), at(180))).toEqual({
      status: 'ok',
      acr: 'step-up',
      authTime,
      fresh: true,
    });
    expect(stepUpStatus(session('step-up', authTime), at(181))).toMatchObject({ fresh: false });
  });

  it('is not fresh without the step-up ACR or an auth_time', () => {
    expect(stepUpStatus(session('1', authTime), at(0))).toMatchObject({ fresh: false });
    expect(stepUpStatus(session(null, null), at(0))).toEqual({
      status: 'ok',
      acr: null,
      authTime: null,
      fresh: false,
    });
  });

  it('says the session has ended when there is none', () => {
    expect(stepUpStatus(null)).toEqual({ status: 'unauthenticated' });
  });
});
