import { createHash, randomBytes } from 'node:crypto';

import { STEP_UP_ACR, STEP_UP_WINDOW_SECONDS } from '@adili/api-kit/client';
import * as oidc from 'openid-client';

import { clearCookie, readCookie, serializeCookie } from './cookies.ts';
import type { IdTokenClaims, OidcProvider, TokenSet } from './oidc-provider.ts';
import { safeReturnTo } from './return-to.ts';
import type { SessionStore } from './session-store.ts';

/*
 * Session design (architecture section 8, BFF pattern):
 * Tokens are kept server-side in Valkey; the browser only holds an opaque, random session ID
 * in an httpOnly SameSite=Lax cookie. Compared with a sealed cookie this keeps Keycloak's
 * three tokens (well over the 4 KB cookie limit together) off the wire, lets sessions be
 * revoked server-side, and stores only a SHA-256 of the ID so a store dump cannot be replayed.
 */

export interface SessionUser {
  subject: string;
  name: string;
  email?: string;
  username?: string;
}

export interface Session {
  user: SessionUser;
  accessToken: string;
  /** Authentication context class of the last sign-in or step-up (`acr`), e.g. `step-up`. */
  acr: string | null;
  /** When the user last actively authenticated (`auth_time`), in seconds since the epoch. */
  authTime: number | null;
}

interface StoredSession {
  user: SessionUser;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken?: string;
  idToken?: string;
  /** Absent on sessions opened before step-up existed. */
  acr?: string | null;
  authTime?: number | null;
  /** When the tokens were last obtained (ms); absent on sessions opened before it was kept. */
  obtainedAt?: number;
}

interface LoginTransaction {
  codeVerifier: string;
  state: string;
  nonce: string;
  returnTo: string;
  /** A step-up: the callback reports the outcome on `returnTo` (`stepUp=done|failed`). */
  stepUp?: boolean;
}

/*
 * A step-up asks Keycloak for `STEP_UP_ACR` (realm `acr.loa.map`: `step-up` is level 2, the
 * one-time code). Keycloak re-runs only the steps whose level has lapsed, so a step-up asks for
 * the code again once its max age ({@link STEP_UP_CODE_MAX_AGE_SECONDS}) is over and is silent
 * before that. The ACR and the window services accept it for come from api-kit, which the
 * services check them with.
 */
export { STEP_UP_ACR, STEP_UP_WINDOW_SECONDS };

/** Query parameter on a step-up's `returnTo` that says how it ended. */
export const STEP_UP_PARAM = 'stepUp';

/**
 * The least time a step-up leaves to affirm and submit: Keycloak's silent answer carries the old
 * `auth_time`, so the code must lapse this long before the window closes.
 */
export const STEP_UP_SUBMIT_MARGIN_SECONDS = 120;

/**
 * The realm's max age for the one-time code (LoA 2, `adili-loa-2` in adili-realm.json): the window
 * less the margin. Within it a step-up is silent; after it Keycloak asks for a new code.
 */
export const STEP_UP_CODE_MAX_AGE_SECONDS = STEP_UP_WINDOW_SECONDS - STEP_UP_SUBMIT_MARGIN_SECONDS;

/**
 * Whether the session holds a step-up recent enough to open the affirmation for a legal act such
 * as submission: within the code's max age, so at least the margin of the window is left. A hint
 * for the UI only: the service that performs the act checks the access token itself.
 */
export function hasFreshStepUp(
  session: Pick<Session, 'acr' | 'authTime'>,
  now: number = Date.now(),
): boolean {
  return (
    session.acr === STEP_UP_ACR &&
    session.authTime !== null &&
    now / 1000 - session.authTime <= STEP_UP_CODE_MAX_AGE_SECONDS
  );
}

export interface BffOptions {
  /** Public origin, e.g. http://localhost:3010. */
  appUrl: string;
  /** Distinguishes cookies of apps sharing a host (cookies ignore ports). */
  cookieName: string;
  provider: OidcProvider;
  store: SessionStore;
  now?: () => number;
  /**
   * More authorize request parameters for a sign-in or step-up, e.g. a demo ticket (#616): a
   * demo account's step-up then needs no code. None by default.
   */
  authorizeParams?: (
    request: Request,
    kind: 'login' | 'step-up',
  ) => Promise<Record<string, string> | undefined>;
  /**
   * Refresh the tokens when they are older than this (ms), not only when they are about to expire,
   * so a session Keycloak ended elsewhere (another app switched the browser's account, #616) ends
   * here within this time. Only when tokens expire by default.
   */
  revalidateAfterMs?: number;
}

/** How {@link Bff.signInAfresh} signs in. */
export interface FreshSignIn {
  /** More authorize request parameters, e.g. a demo ticket. */
  authorizeParams?: Record<string, string>;
  /** Where to land after the callback; `/` by default. */
  returnTo?: string;
}

const TRANSACTION_TTL_SECONDS = 600;
const DEFAULT_SESSION_TTL_SECONDS = 1800;
/** Refresh access tokens this long before they expire. */
const REFRESH_MARGIN_MS = 30_000;

export class Bff {
  private readonly appUrl: URL;
  private readonly secure: boolean;
  private readonly now: () => number;
  private readonly refreshes = new Map<string, Promise<StoredSession | null>>();

  constructor(private readonly options: BffOptions) {
    this.appUrl = new URL(options.appUrl);
    this.secure = this.appUrl.protocol === 'https:';
    this.now = options.now ?? Date.now;
  }

  private get transactionCookie() {
    return `${this.options.cookieName}_login`;
  }

  private get redirectUri() {
    return new URL('/auth/callback', this.appUrl).toString();
  }

  /** GET /auth/login?returnTo=/path: starts Authorization Code + PKCE. */
  login(request: Request): Promise<Response> {
    return this.authorize(request, false);
  }

  /**
   * GET /auth/step-up?returnTo=/path: asks Keycloak for a fresh proof of identity
   * (`acr_values=step-up`) without a full sign-in. The callback replaces the session with the
   * new tokens and returns to `returnTo` with `stepUp=done`, or `stepUp=failed` when Keycloak
   * refused or did not reach the step-up level. Services check `acr` and `auth_time` in the
   * access token themselves.
   */
  stepUp(request: Request): Promise<Response> {
    return this.authorize(request, true);
  }

  /**
   * Ends this app's session and starts a new sign-in with `authorizeParams`, e.g. the demo role
   * switcher's ticket (#616). The callback opens a session for whoever Keycloak signs in.
   */
  async signInAfresh(request: Request, { authorizeParams, returnTo }: FreshSignIn = {}) {
    const sessionId = readCookie(request, this.options.cookieName);
    if (sessionId) await this.options.store.delete(sessionKey(sessionId));
    const response = await this.authorize(request, false, {
      returnTo: safeReturnTo(returnTo ?? '/'),
      extraParams: authorizeParams,
    });
    response.headers.append(
      'set-cookie',
      clearCookie(this.options.cookieName, { secure: this.secure }),
    );
    return response;
  }

  private async authorize(
    request: Request,
    stepUp: boolean,
    fresh?: { returnTo: string; extraParams?: Record<string, string> },
  ): Promise<Response> {
    const returnTo =
      fresh?.returnTo ?? safeReturnTo(new URL(request.url).searchParams.get('returnTo'));
    const extraParams =
      fresh?.extraParams ??
      (await this.options.authorizeParams?.(request, stepUp ? 'step-up' : 'login'));
    const transaction: LoginTransaction = {
      codeVerifier: oidc.randomPKCECodeVerifier(),
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      returnTo,
      ...(stepUp ? { stepUp } : {}),
    };
    const url = await this.options.provider.authorizationUrl({
      redirectUri: this.redirectUri,
      state: transaction.state,
      nonce: transaction.nonce,
      codeChallenge: await oidc.calculatePKCECodeChallenge(transaction.codeVerifier),
      ...(stepUp ? { acrValues: STEP_UP_ACR } : {}),
      ...(extraParams ? { extraParams } : {}),
    });

    const transactionId = randomId();
    await this.options.store.set(
      `login:${hash(transactionId)}`,
      JSON.stringify(transaction),
      TRANSACTION_TTL_SECONDS,
    );
    return redirect(url.toString(), 302, [
      serializeCookie(this.transactionCookie, transactionId, {
        path: '/auth',
        maxAgeSeconds: TRANSACTION_TTL_SECONDS,
        secure: this.secure,
      }),
    ]);
  }

  /** GET /auth/callback: exchanges the code and opens a session. */
  async callback(request: Request): Promise<Response> {
    const clearTransaction = clearCookie(this.transactionCookie, {
      path: '/auth',
      secure: this.secure,
    });
    const requestUrl = new URL(request.url);
    const transaction = await this.takeTransaction(request);
    const fail = (reason: string) =>
      transaction?.stepUp
        ? redirect(this.stepUpOutcome(transaction.returnTo, 'failed'), 302, [clearTransaction])
        : this.failLogin(reason, clearTransaction);

    const providerError = requestUrl.searchParams.get('error');
    if (providerError) return fail(providerError);
    if (!transaction) return this.failLogin('login_expired', clearTransaction);

    let tokens: TokenSet;
    try {
      // Rebuild the URL on the public origin: behind a proxy request.url is internal.
      const callbackUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, this.appUrl);
      tokens = await this.options.provider.exchangeCode(callbackUrl, transaction);
    } catch {
      return fail('login_failed');
    }
    if (!tokens.claims) return fail('login_failed');

    // A new session ID on every sign-in and step-up; the one it replaces is ended.
    const previousId = readCookie(request, this.options.cookieName);
    if (previousId) await this.options.store.delete(sessionKey(previousId));
    const sessionId = randomId();
    await this.saveSession(
      sessionId,
      this.toStoredSession(tokens, userFrom(tokens.claims)),
      tokens,
    );
    const location = transaction.stepUp
      ? this.stepUpOutcome(
          transaction.returnTo,
          tokens.claims.acr === STEP_UP_ACR ? 'done' : 'failed',
        )
      : new URL(transaction.returnTo, this.appUrl).toString();
    return redirect(location, 302, [
      clearTransaction,
      serializeCookie(this.options.cookieName, sessionId, { secure: this.secure }),
    ]);
  }

  /** The login transaction the callback belongs to, used at most once. */
  private async takeTransaction(request: Request): Promise<LoginTransaction | null> {
    const transactionId = readCookie(request, this.transactionCookie);
    if (!transactionId) return null;
    const transactionKey = `login:${hash(transactionId)}`;
    const stored = await this.options.store.get(transactionKey);
    await this.options.store.delete(transactionKey);
    return stored ? (JSON.parse(stored) as LoginTransaction) : null;
  }

  private stepUpOutcome(returnTo: string, outcome: 'done' | 'failed'): string {
    const url = new URL(returnTo, this.appUrl);
    url.searchParams.set(STEP_UP_PARAM, outcome);
    return url.toString();
  }

  /** POST /auth/logout: ends the local session and the Keycloak SSO session. */
  async logout(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    if (origin && origin !== this.appUrl.origin) {
      return new Response('Cross-origin logout refused', { status: 403 });
    }
    const sessionId = readCookie(request, this.options.cookieName);
    let idToken: string | undefined;
    if (sessionId) {
      const key = sessionKey(sessionId);
      const stored = await this.options.store.get(key);
      idToken = stored ? (JSON.parse(stored) as StoredSession).idToken : undefined;
      await this.options.store.delete(key);
    }
    const endSession = await this.options.provider.endSessionUrl({
      idTokenHint: idToken,
      postLogoutRedirectUri: new URL('/', this.appUrl).toString(),
    });
    // 303: the browser follows a POST with a GET.
    return redirect(endSession.toString(), 303, [
      clearCookie(this.options.cookieName, { secure: this.secure }),
    ]);
  }

  /** The signed-in session with a fresh access token, or null. */
  async getSession(request: Request): Promise<Session | null> {
    const sessionId = readCookie(request, this.options.cookieName);
    if (!sessionId) return null;
    const key = sessionKey(sessionId);
    const raw = await this.options.store.get(key);
    if (!raw) return null;

    let session: StoredSession | null = JSON.parse(raw) as StoredSession;
    const revalidate = this.options.revalidateAfterMs;
    if (
      session.accessTokenExpiresAt - this.now() < REFRESH_MARGIN_MS ||
      (revalidate !== undefined && this.now() - (session.obtainedAt ?? 0) >= revalidate)
    ) {
      session = await this.refreshOnce(sessionId, session);
    }
    return session
      ? {
          user: session.user,
          accessToken: session.accessToken,
          acr: session.acr ?? null,
          authTime: session.authTime ?? null,
        }
      : null;
  }

  /** Concurrent requests of one session share a single refresh. */
  private refreshOnce(sessionId: string, session: StoredSession): Promise<StoredSession | null> {
    const key = sessionKey(sessionId);
    let pending = this.refreshes.get(key);
    if (!pending) {
      pending = this.refresh(sessionId, session).finally(() => this.refreshes.delete(key));
      this.refreshes.set(key, pending);
    }
    return pending;
  }

  private async refresh(sessionId: string, session: StoredSession): Promise<StoredSession | null> {
    if (!session.refreshToken) {
      await this.options.store.delete(sessionKey(sessionId));
      return null;
    }
    try {
      const tokens = await this.options.provider.refresh(session.refreshToken);
      const user = tokens.claims ? userFrom(tokens.claims) : session.user;
      const refreshed = this.toStoredSession(tokens, user, session);
      await this.saveSession(sessionId, refreshed, tokens);
      return refreshed;
    } catch {
      // Refresh token expired or revoked in Keycloak: the SSO session is over.
      await this.options.store.delete(sessionKey(sessionId));
      return null;
    }
  }

  private toStoredSession(
    tokens: TokenSet,
    user: SessionUser,
    previous?: StoredSession,
  ): StoredSession {
    return {
      user,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: this.now() + tokens.expiresInSeconds * 1000,
      obtainedAt: this.now(),
      // Keycloak may rotate refresh tokens; keep the old one only if none was returned.
      refreshToken: tokens.refreshToken ?? previous?.refreshToken,
      idToken: tokens.idToken ?? previous?.idToken,
      // A refresh does not authenticate: keep the sign-in's values unless the new ID token says.
      acr: tokens.claims?.acr ?? previous?.acr ?? null,
      authTime: tokens.claims?.auth_time ?? previous?.authTime ?? null,
    };
  }

  private async saveSession(sessionId: string, session: StoredSession, tokens: TokenSet) {
    const ttl =
      tokens.refreshExpiresInSeconds && tokens.refreshExpiresInSeconds > 0
        ? tokens.refreshExpiresInSeconds
        : DEFAULT_SESSION_TTL_SECONDS;
    await this.options.store.set(sessionKey(sessionId), JSON.stringify(session), ttl);
  }

  private failLogin(reason: string, ...cookies: string[]): Response {
    const url = new URL('/', this.appUrl);
    url.searchParams.set('auth_error', reason);
    return redirect(url.toString(), 302, cookies);
  }
}

function userFrom(claims: IdTokenClaims): SessionUser {
  return {
    subject: claims.sub,
    name: claims.name ?? claims.preferred_username ?? claims.email ?? 'Signed-in user',
    email: claims.email,
    username: claims.preferred_username,
  };
}

function redirect(location: string, status: 302 | 303, cookies: string[]): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status, headers });
}

function randomId(): string {
  return randomBytes(32).toString('base64url');
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function sessionKey(sessionId: string): string {
  return `session:${hash(sessionId)}`;
}
