import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { Browser, type KcContext, type Page } from './support/browser.js';
import { latestEmail, latestSmsCode, waitForNew } from './support/inboxes.js';

/**
 * S22 and S23 (spec 03) through the real stack: Keycloak with the adili-otp extension and the
 * Adili theme, the notifications service, the SMS mock and Mailpit. See vitest.stack.config.ts.
 */
const KEYCLOAK = requireEnv('TEST_KEYCLOAK_URL');
const MAILPIT = requireEnv('TEST_MAILPIT_URL');
const MOCKS = requireEnv('TEST_MOCKS_URL');
const REALM = `${KEYCLOAK}/realms/adili`;
const PORTAL = 'http://localhost:3010';
const REDIRECT_URI = `${PORTAL}/auth/callback`;

// Demo users from infra/compose/keycloak/adili-realm.json.
const DECLARANT = {
  username: 'declarant',
  password: 'Adili-Demo-2026',
  phone: '+254700000001',
  email: 'declarant@demo.adili.go.ke',
};
const REVIEWER = { username: 'reviewer', password: 'Adili-Demo-2026' };

/** Starts a portal sign-in (PKCE, the portal's default ACR) and returns the login page. */
async function startSignIn(browser: Browser): Promise<Page> {
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    client_id: 'portal',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid',
    state: randomUUID(),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  return browser.get(`${REALM}/protocol/openid-connect/auth?${params.toString()}`);
}

async function signInWithPassword(user: { username: string; password: string }) {
  const browser = new Browser(KEYCLOAK);
  const login = await startSignIn(browser);
  expect(login.kcContext?.pageId).toBe('login.ftl');
  const page = await browser.post(context(login).url.loginAction, {
    username: user.username,
    password: user.password,
  });
  return { browser, page };
}

function context(page: Page): KcContext {
  if (!page.kcContext) {
    throw new Error(
      `no Keycloak page at ${page.url} (status ${page.status}, location ${page.location})`,
    );
  }
  return page.kcContext;
}

const post = (browser: Browser, page: Page, fields: Record<string, string>) =>
  browser.post(context(page).url.loginAction, fields);

const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

/**
 * Keycloak's brute-force protection locks an account for a minute after two failures within a
 * second (quick login check), which no person typing codes does; tests pace themselves the same.
 */
const humanPause = () => new Promise((resolve) => setTimeout(resolve, 1_100));

describe('S22: declarant sign-in with a one-time code', () => {
  it('sends a code by SMS after the password and signs in with it', async () => {
    const before = await latestSmsCode(MOCKS, DECLARANT.phone);
    const { browser, page } = await signInWithPassword(DECLARANT);

    expect(context(page)).toMatchObject({
      pageId: 'login-adili-otp.ftl',
      channel: 'sms',
      maskedDestination: '07** *** 001',
      alternativeDestination: 'd***@demo.adili.go.ke',
      attemptsLeft: 5,
      resendsLeft: 3,
    });
    expect(context(page).isStepUp).toBeUndefined();
    const sms = await waitForNew(() => latestSmsCode(MOCKS, DECLARANT.phone), before);

    const done = await post(browser, page, { action: 'verify', otp: sms.code });

    expect(done.location).toMatch(new RegExp(`^${REDIRECT_URI}\\?.*code=`));
  });

  it('shows the attempts left after a wrong code, then accepts the right one', async () => {
    const before = await latestSmsCode(MOCKS, DECLARANT.phone);
    const { browser, page } = await signInWithPassword(DECLARANT);
    const sms = await waitForNew(() => latestSmsCode(MOCKS, DECLARANT.phone), before);

    const wrong = await post(browser, page, { action: 'verify', otp: wrongCode(sms.code) });

    expect(context(wrong)).toMatchObject({
      pageId: 'login-adili-otp.ftl',
      otpError: 'invalid',
      attemptsLeft: 4,
    });
    const done = await post(browser, wrong, { action: 'verify', otp: sms.code });
    expect(done.location).toMatch(new RegExp(`^${REDIRECT_URI}\\?`));
  });

  it('stops the sign-in after five wrong codes', async () => {
    const before = await latestSmsCode(MOCKS, DECLARANT.phone);
    const { browser, page: loginPage } = await signInWithPassword(DECLARANT);
    let page = loginPage;
    const sms = await waitForNew(() => latestSmsCode(MOCKS, DECLARANT.phone), before);

    for (let i = 0; i < 5; i += 1) {
      page = await post(browser, page, { action: 'verify', otp: wrongCode(sms.code) });
      await humanPause();
    }

    expect(context(page).pageId).toBe('login.ftl');
    expect(context(page).message?.summary).toContain('Too many wrong codes');
  });

  it('sends the code by email instead when asked, through Mailpit', async () => {
    const { browser, page } = await signInWithPassword(DECLARANT);
    const before = await latestEmail(MAILPIT, DECLARANT.email, /sign-in code/);

    const emailPage = await post(browser, page, { action: 'send-email' });

    expect(context(emailPage)).toMatchObject({
      pageId: 'login-adili-otp.ftl',
      channel: 'email',
      maskedDestination: 'd***@demo.adili.go.ke',
      alternativeDestination: '07** *** 001',
      resendsLeft: 2,
    });
    const email = await waitForNew(
      () => latestEmail(MAILPIT, DECLARANT.email, /sign-in code/),
      before,
    );
    const code = /\b(\d{6})\b/.exec(email.subject)?.[1];
    expect(code).toBeDefined();

    const done = await post(browser, emailPage, { action: 'verify', otp: code ?? '' });
    expect(done.location).toMatch(new RegExp(`^${REDIRECT_URI}\\?`));
  });

  it('holds "Resend code" for the cooldown', async () => {
    const before = await latestSmsCode(MOCKS, DECLARANT.phone);
    const { browser, page } = await signInWithPassword(DECLARANT);
    const first = await waitForNew(() => latestSmsCode(MOCKS, DECLARANT.phone), before);
    const resendAvailableAt = Date.parse(String(context(page).resendAvailableAt));
    expect(resendAvailableAt - Date.now()).toBeGreaterThan(50_000);

    const again = await post(browser, page, { action: 'resend' });

    expect(context(again)).toMatchObject({ pageId: 'login-adili-otp.ftl', resendsLeft: 3 });
    expect(await latestSmsCode(MOCKS, DECLARANT.phone)).toEqual(first);
  });

  it('offers email when the SMS cannot be sent, and signs in with the emailed code', async () => {
    const admin = await adminToken();
    const suffix = Date.now().toString();
    const user = {
      username: `s22-${suffix}`,
      password: `S22-${randomBytes(9).toString('base64url')}!9a`,
      email: `s22-${suffix}@example.go.ke`,
    };
    // Not E.164, so notifications refuses it as it would a number the SMS gateway cannot reach.
    const userId = await createDeclarant(
      admin,
      user.username,
      user.email,
      '0712345678',
      user.password,
    );
    try {
      const { browser, page } = await signInWithPassword(user);

      expect(context(page)).toMatchObject({
        pageId: 'login-adili-otp.ftl',
        channel: 'sms',
        sendFailed: 'sms',
        alternativeDestination: 's***@example.go.ke',
      });

      const emailPage = await post(browser, page, { action: 'send-email' });
      expect(context(emailPage)).toMatchObject({ channel: 'email' });
      expect(context(emailPage).sendFailed).toBeUndefined();
      const email = await waitForNew(
        () => latestEmail(MAILPIT, user.email, /sign-in code/),
        undefined,
      );
      const code = /\b(\d{6})\b/.exec(email.subject)?.[1] ?? '';

      const done = await post(browser, emailPage, { action: 'verify', otp: code });
      expect(done.location).toMatch(new RegExp(`^${REDIRECT_URI}\\?`));
    } finally {
      await adminFetch(admin, `/users/${userId}`, { method: 'DELETE' });
    }
  });

  it('leaves staff on TOTP', async () => {
    const { page } = await signInWithPassword(REVIEWER);

    // The demo reviewer has no authenticator app yet, so Keycloak asks them to set one up.
    expect(['login-otp.ftl', 'login-config-totp.ftl']).toContain(context(page).pageId);
  });
});

describe('S23: a new declarant sets their password from the emailed link', () => {
  it('opens the branded update-password page and returns to the portal', async () => {
    const admin = await adminToken();
    const username = `OFR-${Date.now().toString().slice(-7)}-S`;
    const email = `s23-${Date.now()}@example.go.ke`;
    const userId = await createDeclarant(admin, username, email);

    await adminFetch(
      admin,
      `/users/${userId}/execute-actions-email?client_id=portal&redirect_uri=${encodeURIComponent(PORTAL)}&lifespan=86400`,
      {
        method: 'PUT',
        body: JSON.stringify(['UPDATE_PASSWORD']),
      },
    );
    const message = await waitForNew(() => latestEmail(MAILPIT, email, /.*/), undefined);
    const link = /(https?:\/\/\S+action-token\S+)/.exec(message.text)?.[1];
    expect(link).toBeDefined();

    const browser = new Browser(KEYCLOAK);
    let page = await browser.get(link ?? '');
    // Keycloak lists the actions first and links on to them.
    if (context(page).pageId === 'info.ftl') {
      const proceed = context(page).actionUri;
      expect(typeof proceed).toBe('string');
      page = await browser.get(String(proceed));
    }
    expect(context(page).pageId).toBe('login-update-password.ftl');

    const password = `S23-${randomBytes(9).toString('base64url')}!9a`;
    const done = await post(browser, page, {
      'password-new': password,
      'password-confirm': password,
    });

    // The theme's "password set" page (reworded Keycloak copy) continues to the portal.
    expect(context(done)).toMatchObject({
      pageId: 'info.ftl',
      message: { type: 'success', summary: 'Your password is set.' },
    });
    expect(String(context(done).pageRedirectUri)).toMatch(new RegExp(`^${PORTAL}`));
    await adminFetch(admin, `/users/${userId}`, { method: 'DELETE' });
  });
});

async function adminToken(): Promise<string> {
  const response = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'admin',
      password: 'admin_dev',
    }),
  });
  if (!response.ok) throw new Error(`admin token: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function adminFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${KEYCLOAK}/admin/realms/adili${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  if (!response.ok)
    throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
  return response;
}

async function createDeclarant(
  token: string,
  username: string,
  email: string,
  phone = '+254700000099',
  password?: string,
): Promise<string> {
  const response = await adminFetch(token, '/users', {
    method: 'POST',
    body: JSON.stringify({
      username,
      email,
      emailVerified: true,
      enabled: true,
      attributes: { tenant: ['psc'], phone: [phone] },
      credentials: password ? [{ type: 'password', value: password, temporary: false }] : [],
    }),
  });
  const userId = response.headers.get('location')?.split('/').pop() ?? '';
  const role = (await (await adminFetch(token, '/roles/declarant')).json()) as object;
  await adminFetch(token, `/users/${userId}/role-mappings/realm`, {
    method: 'POST',
    body: JSON.stringify([role]),
  });
  return userId;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (see vitest.stack.config.ts)`);
  return value;
}
