import { randomBytes } from 'node:crypto';

import * as oidc from 'openid-client';

import { DEMO_TICKET_PARAM, mintDemoTicket } from './ticket.ts';

export interface DemoSignInOptions {
  /** e.g. `http://localhost:8080/realms/adili`. */
  issuerUrl: string;
  /** A confidential client with the code flow, e.g. `portal` or `console`. */
  clientId: string;
  clientSecret: string;
  /** One of the client's redirect URIs; never requested, only matched. */
  redirectUri: string;
  /** The account's `demo_key` attribute. */
  demoKey: string;
  /** Keycloak's `demo-ticket-secret`. */
  ticketSecret: string;
  /** Requested `acr_values`; the portal and console clients default to `step-up`. */
  acrValues?: string;
}

export interface DemoTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresInSeconds: number;
  /** `step-up` when Keycloak recorded LoA 2, as password plus code would. */
  acr?: string;
  /** Seconds since the epoch: this sign-in. */
  authTime?: number;
}

/**
 * Signs a demo account in through the authorization code flow with a fresh demo ticket, without a
 * browser: Keycloak's `adili-demo` authenticator accepts the ticket in the authorize request and
 * redirects straight back with a code, which is exchanged here. For seeding and tests against a
 * Keycloak running with `ADILI_DEMO_MODE=true`; throws when Keycloak shows a page instead (demo
 * mode off, a bad secret, or an account without that `demo_key`).
 */
export async function demoSignIn(options: DemoSignInOptions): Promise<DemoTokens> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await signInOnce(options);
    } catch (error) {
      // A connection dropped mid-exchange (the hosted VM reaches Keycloak through its own public
      // address, and a reused keep-alive socket can be closed under it). Each attempt mints a
      // fresh ticket, since a used one is refused.
      if (attempt >= SIGN_IN_ATTEMPTS || !isDroppedConnection(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
}

const SIGN_IN_ATTEMPTS = 4;

/** True when the error, or anything in its cause chain, is a connection closed under a request. */
export function isDroppedConnection(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 8; depth++) {
    const { message = '', code = '' } = current as { message?: unknown; code?: unknown };
    if (
      /terminated|other side closed|socket hang up|fetch failed/i.test(String(message)) ||
      /UND_ERR_SOCKET|ECONNRESET|EPIPE/.test(String(code))
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function signInOnce(options: DemoSignInOptions): Promise<DemoTokens> {
  const issuer = new URL(options.issuerUrl);
  const config = await oidc.discovery(issuer, options.clientId, options.clientSecret, undefined, {
    // Local Keycloak is plain HTTP; deprecated only as a warning sign.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    execute: issuer.protocol === 'http:' ? [oidc.allowInsecureRequests] : [],
  });
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const state = randomBytes(16).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');
  const parameters: Record<string, string> = {
    redirect_uri: options.redirectUri,
    scope: 'openid profile email',
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce,
    [DEMO_TICKET_PARAM]: mintDemoTicket({ demoKey: options.demoKey, secret: options.ticketSecret }),
  };
  if (options.acrValues) parameters.acr_values = options.acrValues;

  const callback = await followToRedirectUri(
    oidc.buildAuthorizationUrl(config, parameters),
    options.redirectUri,
  );
  const tokens = await oidc.authorizationCodeGrant(config, callback, {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
    expectedNonce: nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresInSeconds: tokens.expiresIn() ?? 60,
    acr: typeof claims?.acr === 'string' ? claims.acr : undefined,
    authTime: typeof claims?.auth_time === 'number' ? claims.auth_time : undefined,
  };
}

/** Follows Keycloak's redirects, keeping its cookies, to the first one back at `redirectUri`. */
async function followToRedirectUri(start: URL, redirectUri: string): Promise<URL> {
  const cookies = new Map<string, string>();
  let url = start;
  for (let hop = 0; hop < 10; hop++) {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ''] = cookie.split(';');
      const index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (response.status < 300 || response.status >= 400 || !location) {
      throw new Error(
        `demo sign-in: Keycloak answered ${response.status} at ${url.pathname} instead of redirecting; is ADILI_DEMO_MODE on and the demo key known?`,
      );
    }
    url = new URL(location, url);
    if (url.toString().startsWith(redirectUri)) {
      if (url.searchParams.has('error')) {
        throw new Error(`demo sign-in: ${url.searchParams.get('error')}`);
      }
      return url;
    }
  }
  throw new Error('demo sign-in: too many redirects');
}
