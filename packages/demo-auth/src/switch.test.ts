import { Bff, MemorySessionStore, type OidcProvider } from '@adili/bff-auth';
import { describe, expect, it, vi } from 'vitest';

import type { DemoSwitchEvent } from './audit.ts';
import { createDemoSwitch, demoStepUpParams } from './switch.ts';

const APP_URL = 'http://localhost:3020';
const SECRET = 'test-demo-ticket-secret';

function jwt(claims: Record<string, unknown>): string {
  return `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
}

const REVIEWER = jwt({
  sub: 'sub-reviewer',
  preferred_username: 'reviewer',
  tenant: 'psc',
  demo_key: 'reviewer',
  realm_access: { roles: ['default-roles-adili', 'reviewer'] },
});

function setup(record = vi.fn<(event: DemoSwitchEvent) => Promise<void>>(() => Promise.resolve())) {
  const provider: OidcProvider = {
    authorizationUrl: vi.fn<OidcProvider['authorizationUrl']>(({ state, extraParams }) => {
      const url = new URL(`http://keycloak.test/auth?state=${state}`);
      for (const [name, value] of Object.entries(extraParams ?? {}))
        url.searchParams.set(name, value);
      return Promise.resolve(url);
    }),
    exchangeCode: vi.fn(() =>
      Promise.resolve({
        accessToken: REVIEWER,
        expiresInSeconds: 300,
        refreshToken: 'refresh',
        claims: { sub: 'sub-reviewer', name: 'Achieng Njeri', preferred_username: 'reviewer' },
      }),
    ),
    refresh: vi.fn(),
    endSessionUrl: vi.fn(),
  };
  const bff = new Bff({
    appUrl: APP_URL,
    cookieName: 'adili_console',
    provider,
    store: new MemorySessionStore(),
  });
  const demo = createDemoSwitch({
    app: 'console',
    bff,
    appUrl: APP_URL,
    ticketSecret: SECRET,
    record,
  });
  return { bff, demo, provider, record };
}

/** Signs the reviewer in through the BFF; returns the session cookie. */
async function signIn(bff: Bff): Promise<string> {
  const login = await bff.login(new Request(`${APP_URL}/auth/login`));
  const loginCookie = login.headers.getSetCookie()[0]?.split(';')[0] ?? '';
  const callback = await bff.callback(
    new Request(`${APP_URL}/auth/callback?code=c&state=s`, { headers: { cookie: loginCookie } }),
  );
  return (
    callback.headers
      .getSetCookie()
      .find((c) => c.startsWith('adili_console='))
      ?.split(';')[0] ?? ''
  );
}

function switchRequest(as: string, init: { cookie?: string; origin?: string } = {}) {
  return new Request(`${APP_URL}/auth/demo-switch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.origin ? { origin: init.origin } : {}),
    },
    body: new URLSearchParams({ as }),
  });
}

describe('createDemoSwitch', () => {
  it('records who switched to whom, then signs in afresh with a ticket for the account', async () => {
    const { bff, demo, record } = setup();
    const cookie = await signIn(bff);

    const response = await demo.switchAccount(
      switchRequest('eacc-analyst', { cookie, origin: APP_URL }),
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.searchParams.get('demo_ticket')).toMatch(/^v1\./);
    expect(record).toHaveBeenCalledOnce();
    const [event] = record.mock.calls[0] ?? [];
    expect(event).toMatchObject({
      type: 'audit.demo-switch.v1',
      source: 'adili/console',
      subject: 'eacc-analyst',
      data: {
        app: 'console',
        from: { username: 'reviewer', subject: 'sub-reviewer', tenant: 'psc', roles: ['reviewer'] },
        to: { username: 'eacc-analyst' },
        outcome: 'success',
      },
    });
    expect(await bff.getSession(new Request(APP_URL, { headers: { cookie } }))).toBeNull();
  });

  it('records a switch from nobody when signed out', async () => {
    const { demo, record } = setup();

    await demo.switchAccount(switchRequest('reviewer'));

    expect(record.mock.calls[0]?.[0].data.from).toBeNull();
  });

  it('does not switch when the switch cannot be recorded', async () => {
    const { demo } = setup(vi.fn(() => Promise.reject(new Error('broker down'))));

    expect((await demo.switchAccount(switchRequest('reviewer'))).status).toBe(503);
  });

  it('refuses unknown accounts, accounts of the other app and cross-origin posts', async () => {
    const { demo, record } = setup();

    expect((await demo.switchAccount(switchRequest('root'))).status).toBe(400);
    expect((await demo.switchAccount(switchRequest('wanjiku'))).status).toBe(400);
    expect(
      (await demo.switchAccount(switchRequest('reviewer', { origin: 'http://evil.test' }))).status,
    ).toBe(403);
    expect(record).not.toHaveBeenCalled();
  });

  it("gives a demo account's step-up a ticket, and nothing else", async () => {
    const { bff, demo } = setup();
    const cookie = await signIn(bff);
    const request = new Request(APP_URL, { headers: { cookie } });

    expect((await demoStepUpParams(bff, request, 'step-up', SECRET))?.demo_ticket).toMatch(/^v1\./);
    expect(await demoStepUpParams(bff, request, 'login', SECRET)).toBeUndefined();
    expect(await demoStepUpParams(bff, new Request(APP_URL), 'step-up', SECRET)).toBeUndefined();
    expect(await demo.currentDemoKey(request)).toBe('reviewer');
  });

  describe("enter (the deck's deep link)", () => {
    const enter = (query: string, cookie?: string) =>
      new Request(`${APP_URL}/auth/demo-enter?${query}`, {
        headers: cookie ? { cookie } : {},
      });

    it('switches to the account, recorded, and lands on the view', async () => {
      const { demo, record } = setup();

      const response = await demo.enter(enter('as=eacc-analyst&next=%2Freports%3Ffy%3D2026'));

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get('location') ?? '');
      expect(location.searchParams.get('demo_ticket')).toMatch(/^v1\./);
      expect(record.mock.calls[0]?.[0].data.to).toEqual(
        expect.objectContaining({ username: 'eacc-analyst' }),
      );
      const login = response.headers
        .getSetCookie()
        .find((c) => c.startsWith('adili_console_login='));
      expect(login).toBeDefined();
    });

    it('only redirects when already signed in as the account', async () => {
      const { bff, demo, record } = setup();
      const cookie = await signIn(bff);

      const response = await demo.enter(enter('as=reviewer&next=%2Freview', cookie));

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/review');
      expect(record).not.toHaveBeenCalled();
    });

    it('lands on / for a next that is not a path on the app', async () => {
      const { bff, demo } = setup();
      const cookie = await signIn(bff);

      for (const next of ['https://evil.test/', '//evil.test', '/\\evil.test']) {
        const response = await demo.enter(
          enter(`as=reviewer&next=${encodeURIComponent(next)}`, cookie),
        );
        expect(response.headers.get('location')).toBe('/');
      }
    });

    it("refuses unknown accounts and the other app's accounts", async () => {
      const { demo, record } = setup();

      expect((await demo.enter(enter('as=root'))).status).toBe(400);
      expect((await demo.enter(enter('as=wanjiku'))).status).toBe(400);
      expect((await demo.enter(enter('next=%2F'))).status).toBe(400);
      expect(record).not.toHaveBeenCalled();
    });
  });
});
