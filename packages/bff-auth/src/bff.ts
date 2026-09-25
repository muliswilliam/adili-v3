import { createHash, randomBytes } from 'node:crypto';

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
}

interface StoredSession {
  user: SessionUser;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken?: string;
  idToken?: string;
}

interface LoginTransaction {
  codeVerifier: string;
  state: string;
  nonce: string;
  returnTo: string;
}

export interface BffOptions {
  /** Public origin, e.g. http://localhost:3010. */
  appUrl: string;
  /** Distinguishes cookies of apps sharing a host (cookies ignore ports). */
  cookieName: string;
  provider: OidcProvider;
  store: SessionStore;
  now?: () => number;
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
  async login(request: Request): Promise<Response> {
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'));
    const transaction: LoginTransaction = {
      codeVerifier: oidc.randomPKCECodeVerifier(),
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      returnTo,
    };
    const url = await this.options.provider.authorizationUrl({
      redirectUri: this.redirectUri,
      state: transaction.state,
      nonce: transaction.nonce,
      codeChallenge: await oidc.calculatePKCECodeChallenge(transaction.codeVerifier),
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
    const providerError = requestUrl.searchParams.get('error');
    if (providerError) {
      return this.failLogin(providerError, clearTransaction);
    }

    const transactionId = readCookie(request, this.transactionCookie);
    if (!transactionId) {
      return this.failLogin('login_expired', clearTransaction);
    }
    const transactionKey = `login:${hash(transactionId)}`;
    const stored = await this.options.store.get(transactionKey);
    await this.options.store.delete(transactionKey);
    if (!stored) {
      return this.failLogin('login_expired', clearTransaction);
    }
    const transaction = JSON.parse(stored) as LoginTransaction;

    let tokens: TokenSet;
    try {
      // Rebuild the URL on the public origin: behind a proxy request.url is internal.
      const callbackUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, this.appUrl);
      tokens = await this.options.provider.exchangeCode(callbackUrl, transaction);
    } catch {
      return this.failLogin('login_failed', clearTransaction);
    }
    if (!tokens.claims) {
      return this.failLogin('login_failed', clearTransaction);
    }

    const sessionId = randomId();
    await this.saveSession(
      sessionId,
      this.toStoredSession(tokens, userFrom(tokens.claims)),
      tokens,
    );
    return redirect(new URL(transaction.returnTo, this.appUrl).toString(), 302, [
      clearTransaction,
      serializeCookie(this.options.cookieName, sessionId, { secure: this.secure }),
    ]);
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
    if (session.accessTokenExpiresAt - this.now() < REFRESH_MARGIN_MS) {
      session = await this.refreshOnce(sessionId, session);
    }
    return session ? { user: session.user, accessToken: session.accessToken } : null;
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
      // Keycloak may rotate refresh tokens; keep the old one only if none was returned.
      refreshToken: tokens.refreshToken ?? previous?.refreshToken,
      idToken: tokens.idToken ?? previous?.idToken,
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
