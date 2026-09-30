import {
  Bff,
  createOpenIdProvider,
  MemorySessionStore,
  type Session,
  STEP_UP_ACR,
  STEP_UP_CODE_MAX_AGE_SECONDS,
  STEP_UP_WINDOW_SECONDS,
} from '@adili/bff-auth';
import { afterEach, describe, expect, it } from 'vitest';

import { keycloakAdmin } from './support/admin.js';
import { Browser, context, type Page } from './support/browser.js';
import { latestSmsCode, waitForNew } from './support/inboxes.js';

/**
 * S16 (spec 06): step-up before submission, through the portal's BFF (`@adili/bff-auth` with the
 * real OpenID client) against Keycloak with the adili-otp extension, the notifications service
 * and the SMS mock. See vitest.stack.config.ts.
 */
const KEYCLOAK = requireEnv('TEST_KEYCLOAK_URL');
const MOCKS = requireEnv('TEST_MOCKS_URL');
const { adminToken, changeConfig, readConfig } = keycloakAdmin(KEYCLOAK);
const PORTAL = 'http://localhost:3010';
const COOKIE = 'adili_portal';
const SUMMARY = '/declarations/0b8e7c1a-3f2d-4e5a-9b6c-7d8e9f0a1b2c/summary';

// Demo user and the portal client's development secret from infra/compose/keycloak/adili-realm.json.
const DECLARANT = { username: 'declarant', password: 'Adili-Demo-2026', phone: '+254700000001' };

/** The portal's BFF and one declarant's browser: Keycloak's cookies and the portal's. */
function portal() {
  const bff = new Bff({
    appUrl: PORTAL,
    cookieName: COOKIE,
    provider: createOpenIdProvider({
      issuerUrl: `${KEYCLOAK}/realms/adili`,
      clientId: 'portal',
      clientSecret: 'portal-dev-secret',
      allowHttp: true,
    }),
    store: new MemorySessionStore(),
  });
  const browser = new Browser(KEYCLOAK);
  let session = '';

  /** GETs a BFF auth route and follows it into Keycloak, keeping the login cookie for later. */
  async function start(path: string) {
    const request = new Request(`${PORTAL}${path}`, { headers: { cookie: session } });
    const response = await (path.startsWith('/auth/step-up')
      ? bff.stepUp(request)
      : bff.login(request));
    const loginCookie = setCookie(response, `${COOKIE}_login`);
    const page = await browser.get(response.headers.get('location') ?? '');
    return { page, loginCookie };
  }

  /** Hands Keycloak's redirect back to the BFF's callback; returns where the portal sends next. */
  async function callback(page: Page, loginCookie: string): Promise<URL> {
    expect(page.location).toMatch(new RegExp(`^${PORTAL}/auth/callback\\?`));
    const response = await bff.callback(
      new Request(page.location ?? '', {
        headers: { cookie: [session, loginCookie].filter(Boolean).join('; ') },
      }),
    );
    session = setCookie(response, COOKIE);
    return new URL(response.headers.get('location') ?? '');
  }

  async function currentSession(): Promise<Session> {
    const current = await bff.getSession(new Request(PORTAL, { headers: { cookie: session } }));
    if (!current) throw new Error('no portal session');
    return current;
  }

  return { browser, start, callback, currentSession };
}

type Portal = ReturnType<typeof portal>;

/** Signs the declarant in with password and SMS code, as on the portal's sign-in button. */
async function signIn(app: Portal) {
  const before = await latestSmsCode(MOCKS, DECLARANT.phone);
  const { page, loginCookie } = await app.start('/auth/login?returnTo=%2F');
  const codePage = await app.browser.post(context(page).url.loginAction, {
    username: DECLARANT.username,
    password: DECLARANT.password,
  });
  const sms = await waitForNew(() => latestSmsCode(MOCKS, DECLARANT.phone), before);
  const done = await app.browser.post(context(codePage).url.loginAction, {
    action: 'verify',
    otp: sms.code,
  });
  await app.callback(done, loginCookie);
  return app.currentSession();
}

function stepUpPath(returnTo: string) {
  return `/auth/step-up?returnTo=${encodeURIComponent(returnTo)}`;
}

/** The claims of a JWT, which Keycloak signed (services verify it; here only the claims matter). */
function claimsOf(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function setCookie(response: Response, name: string): string {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (!cookie) throw new Error(`no ${name} cookie set`);
  return cookie.split(';')[0] ?? '';
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('S16: step-up re-runs only the one-time code', () => {
  let restore: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await restore?.();
    restore = undefined;
  });

  it('lapses the code before the submit window, so a silent step-up leaves time to submit', async () => {
    const loa = await readConfig(await adminToken(), 'conditional-level-of-authentication');

    expect(loa.config).toMatchObject({
      'loa-condition-level': '2',
      'loa-max-age': String(STEP_UP_CODE_MAX_AGE_SECONDS),
    });
  });

  it('counts a sign-in as a step-up: it asks for the code too, so a submit within the window needs no other', async () => {
    const signInStarted = nowSeconds();
    const signedIn = await signIn(portal());

    // The access token services check, as a step-up's: acr step-up, auth_time the sign-in's.
    const claims = claimsOf(signedIn.accessToken);
    expect(claims.acr).toBe(STEP_UP_ACR);
    expect(claims.auth_time).toBe(signedIn.authTime);
    // Keycloak's clock, a little off the host's.
    expect(signedIn.authTime).toBeGreaterThanOrEqual(signInStarted - 2);
    expect(nowSeconds() - (signedIn.authTime ?? 0)).toBeLessThan(STEP_UP_WINDOW_SECONDS);
  });

  it('asks a signed-in declarant for a new code only, then carries acr and a fresh auth_time', async () => {
    const app = portal();
    const signedIn = await signIn(app);
    expect(signedIn.acr).toBe(STEP_UP_ACR);
    expect(signedIn.authTime).toBeGreaterThan(0);

    // Let the code (LoA 2) lapse while the password (LoA 1) holds, rather than wait out its max age.
    restore = await changeConfig(await adminToken(), 'conditional-level-of-authentication', {
      'loa-max-age': '1',
    });
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const before = await latestSmsCode(MOCKS, DECLARANT.phone);
    const stepUpStarted = nowSeconds();

    const { page, loginCookie } = await app.start(stepUpPath(`${SUMMARY}?stepUp=done`));

    // Straight to the code page: no username or password.
    expect(context(page)).toMatchObject({ pageId: 'login-adili-otp.ftl', isStepUp: true });
    expect(page.html).not.toContain('name="password"');
    await restore();
    restore = undefined;
    const sms = await waitForNew(() => latestSmsCode(MOCKS, DECLARANT.phone), before);
    const done = await app.browser.post(context(page).url.loginAction, {
      action: 'verify',
      otp: sms.code,
    });
    const back = await app.callback(done, loginCookie);

    expect(`${back.pathname}${back.search}`).toBe(`${SUMMARY}?stepUp=done`);
    const steppedUp = await app.currentSession();
    expect(steppedUp.acr).toBe(STEP_UP_ACR);
    // Keycloak's clock, a little off the host's: fresh means around the step-up, after sign-in.
    expect(steppedUp.authTime).toBeGreaterThan(signedIn.authTime ?? Infinity);
    expect(steppedUp.authTime).toBeGreaterThanOrEqual(stepUpStarted - 2);
    expect(steppedUp.authTime).toBeLessThanOrEqual(nowSeconds() + 2);
    // Services read the same claims from the access token (api-kit Principal acr, authTime).
    expect(claimsOf(steppedUp.accessToken)).toMatchObject({
      acr: STEP_UP_ACR,
      auth_time: steppedUp.authTime,
    });

    // Within the code's max age a second step-up is silent: Keycloak answers straight away.
    const again = await app.start(stepUpPath(SUMMARY));

    expect(again.page.kcContext).toBeUndefined();
    const backAgain = await app.callback(again.page, again.loginCookie);
    expect(`${backAgain.pathname}${backAgain.search}`).toBe(`${SUMMARY}?stepUp=done`);
    expect(await app.currentSession()).toMatchObject({
      acr: STEP_UP_ACR,
      authTime: steppedUp.authTime,
    });
  });
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see vitest.stack.config.ts)`);
  return value;
}
