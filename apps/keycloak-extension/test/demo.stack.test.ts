import { createHmac } from 'node:crypto';

import { DEMO_TICKET_PARAM, demoSignIn, mintDemoTicket } from '@adili/demo-auth';
import { describe, expect, it } from 'vitest';

import { Browser, context } from './support/browser.js';

/**
 * Demo sign-in (#616): Keycloak's adili-demo authenticator signs a demo account in from a signed
 * ticket, with no password or code, at LoA 2 (`acr=step-up`). Needs Keycloak running with
 * `ADILI_DEMO_MODE=true` (CI does). Without it, or with any bad ticket, sign-in falls through to
 * the password form; the authenticator's own tests cover demo mode off.
 */
const KEYCLOAK = requireEnv('TEST_KEYCLOAK_URL');
const ISSUER = `${KEYCLOAK}/realms/adili`;
// The development vault entry (infra/compose/keycloak/vault-dev/adili_demo-ticket-secret).
const SECRET = 'adili-dev-demo-ticket-secret-change-me-for-real-use';
const CONSOLE = {
  clientId: 'console',
  clientSecret: 'console-dev-secret',
  redirectUri: 'http://localhost:3020/auth/callback',
};
const PORTAL = {
  clientId: 'portal',
  clientSecret: 'portal-dev-secret',
  redirectUri: 'http://localhost:3010/auth/callback',
};

/** An authorize request for the console, as the BFF builds it, with `extra` parameters. */
function authorizeUrl(extra: Record<string, string>): string {
  const url = new URL(`${ISSUER}/protocol/openid-connect/auth`);
  url.search = new URLSearchParams({
    client_id: CONSOLE.clientId,
    redirect_uri: CONSOLE.redirectUri,
    response_type: 'code',
    scope: 'openid',
    state: 'state-1',
    nonce: 'nonce-1',
    // The clients require PKCE: RFC 7636's example challenge, for VERIFIER.
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    ...extra,
  }).toString();
  return url.toString();
}

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

/** Exchanges the code in a console callback URL; returns the access token's claims. */
async function exchange(callback: string | undefined): Promise<Record<string, unknown>> {
  const code = new URL(callback ?? '').searchParams.get('code') ?? '';
  const response = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CONSOLE.redirectUri,
      client_id: CONSOLE.clientId,
      client_secret: CONSOLE.clientSecret,
      code_verifier: VERIFIER,
    }),
  });
  if (!response.ok) throw new Error(`token: ${response.status} ${await response.text()}`);
  return payloadOf(((await response.json()) as { access_token: string }).access_token);
}

/** Where the request ends: the console's callback with a code, or a Keycloak page. */
async function signInWith(ticket: string, browser = new Browser(KEYCLOAK)) {
  return browser.get(authorizeUrl({ [DEMO_TICKET_PARAM]: ticket }));
}

function payloadOf(jwt: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()) as Record<
    string,
    unknown
  >;
}

describe('demo sign-in (#616)', () => {
  it('signs a staff demo account in at step-up with no password or code', async () => {
    const before = Math.floor(Date.now() / 1000);
    const tokens = await demoSignIn({
      issuerUrl: ISSUER,
      ...CONSOLE,
      demoKey: 'reviewer',
      ticketSecret: SECRET,
    });

    expect(tokens.acr).toBe('step-up');
    expect(tokens.authTime).toBeGreaterThanOrEqual(before - 5);
    const access = payloadOf(tokens.accessToken);
    expect(access.preferred_username).toBe('reviewer');
    expect(access.tenant).toBe('psc');
  });

  it('signs a declarant demo account in through the portal with no SMS code', async () => {
    const tokens = await demoSignIn({
      issuerUrl: ISSUER,
      ...PORTAL,
      demoKey: 'declarant',
      ticketSecret: SECRET,
    });

    expect(tokens.acr).toBe('step-up');
    expect(payloadOf(tokens.accessToken).person_id).toBe('7d3f9b2a-4c1e-4a8b-9f60-2e5d8c1b0a47');
  });

  it('passes a later step-up with a fresh ticket, without a page', async () => {
    const browser = new Browser(KEYCLOAK);
    const first = await signInWith(
      mintDemoTicket({ demoKey: 'supervisor', secret: SECRET }),
      browser,
    );
    expect(first.location).toMatch(/^http:\/\/localhost:3020\/auth\/callback\?.*code=/);

    const stepUp = await browser.get(
      authorizeUrl({
        acr_values: 'step-up',
        max_age: '0',
        [DEMO_TICKET_PARAM]: mintDemoTicket({ demoKey: 'supervisor', secret: SECRET }),
      }),
    );
    expect(stepUp.location).toMatch(/^http:\/\/localhost:3020\/auth\/callback\?.*code=/);
  });

  it('switches a signed-in browser to another account and ends the previous SSO session', async () => {
    const browser = new Browser(KEYCLOAK);
    const first = await signInWith(
      mintDemoTicket({ demoKey: 'reporting-officer', secret: SECRET }),
      browser,
    );
    expect((await exchange(first.location)).preferred_username).toBe('reporting-officer');

    const switched = await signInWith(
      mintDemoTicket({ demoKey: 'eacc-analyst', secret: SECRET }),
      browser,
    );
    expect((await exchange(switched.location)).preferred_username).toBe('eacc-analyst');

    // No ticket: the SSO cookie now signs in the account switched to, not the previous one.
    const again = await browser.get(authorizeUrl({}));
    expect((await exchange(again.location)).preferred_username).toBe('eacc-analyst');
  });

  it('falls through to the password form for a reused ticket', async () => {
    const ticket = mintDemoTicket({ demoKey: 'auditor', secret: SECRET });
    expect((await signInWith(ticket)).location).toMatch(/code=/);

    expect(context(await signInWith(ticket)).pageId).toBe('login.ftl');
  });

  it('falls through to the password form for a ticket signed with another secret', async () => {
    const page = await signInWith(mintDemoTicket({ demoKey: 'auditor', secret: 'not-the-secret' }));

    expect(context(page).pageId).toBe('login.ftl');
  });

  it('falls through to the password form for an expired ticket', async () => {
    const ticket = mintDemoTicket({
      demoKey: 'auditor',
      secret: SECRET,
      now: new Date(Date.now() - 10 * 60_000),
    });

    expect(context(await signInWith(ticket)).pageId).toBe('login.ftl');
  });

  it('falls through to the password form for a ticket valid for too long', async () => {
    // mintDemoTicket refuses a long lifetime, so sign one by hand.
    const payload = Buffer.from(
      JSON.stringify({
        k: 'auditor',
        exp: Math.floor(Date.now() / 1000) + 3600,
        n: 'n'.repeat(24),
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', SECRET).update(`v1.${payload}`).digest('base64url');

    expect(context(await signInWith(`v1.${payload}.${signature}`)).pageId).toBe('login.ftl');
  });

  it('never signs in an account without a demo key', async () => {
    // Usernames are not demo keys: only the demo_key attribute names an account.
    const page = await signInWith(
      mintDemoTicket({ demoKey: 'service-account-directory', secret: SECRET }),
    );

    expect(context(page).pageId).toBe('login.ftl');
  });
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
