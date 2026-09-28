/**
 * Header naming the tenant a service acts for when it calls another service's internal API
 * with its own token. The callee trusts it only for tokens carrying the scope that grants that
 * internal API (e.g. `documents:internal`), and still checks the resource belongs to the tenant:
 * internal routes only, the recorded exception to "tenant from token claims" in ADR-013 §8.1.
 */
export const ACTING_TENANT_HEADER = 'x-acting-tenant';

export interface ServiceTokenClientOptions {
  /** Realm issuer, e.g. `http://localhost:8080/realms/adili` (the service's OIDC_ISSUER_URL). */
  issuerUrl: string;
  /** The calling service's confidential Keycloak client. */
  clientId: string;
  clientSecret: string;
  /** Scopes to request; the client's default scopes apply either way. */
  scopes?: readonly string[];
  /** Fetch a new token this long before the cached one expires. Default 30 s. */
  refreshMarginMs?: number;
  /** Per request. Default 5 s. */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
  now?: () => number;
}

/** Keycloak did not issue a token (unreachable, refused the credentials, or answered garbage). */
export class ServiceTokenError extends Error {
  constructor(
    message: string,
    /** HTTP status of the token endpoint; undefined when it was not reached. */
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ServiceTokenError';
  }
}

interface CachedToken {
  value: string;
  refreshAt: number;
}

/**
 * Access tokens for system work through the OAuth client credentials grant (ADR-013 §5): a
 * service calling another service's internal API as itself. Tokens are cached until shortly
 * before they expire and concurrent callers share one token request.
 *
 * @example
 * const tokens = new ServiceTokenClient({ issuerUrl, clientId: 'directory', clientSecret });
 * await fetch(url, { headers: { authorization: `Bearer ${await tokens.token()}` } });
 */
export class ServiceTokenClient {
  private cached: CachedToken | undefined;
  private pending: Promise<string> | undefined;
  private readonly tokenUrl: string;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: ServiceTokenClientOptions) {
    this.tokenUrl = `${options.issuerUrl.replace(/\/$/, '')}/protocol/openid-connect/token`;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  /** A valid access token, from the cache when it is not about to expire. */
  token(): Promise<string> {
    if (this.cached && this.now() < this.cached.refreshAt) {
      return Promise.resolve(this.cached.value);
    }
    this.pending ??= this.request().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  /** Drops the cached token, e.g. after the callee answered 401 to it. */
  invalidate(): void {
    this.cached = undefined;
  }

  private async request(): Promise<string> {
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
    });
    if (this.options.scopes?.length) form.set('scope', this.options.scopes.join(' '));
    const requestedAt = this.now();
    let response: Response;
    try {
      response = await this.fetch(this.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
      });
    } catch (error) {
      throw new ServiceTokenError(`Token endpoint ${this.tokenUrl} unreachable`, undefined, {
        cause: error,
      });
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ServiceTokenError(
        `Token endpoint refused client ${this.options.clientId}: ${response.status} ${detail}`.trim(),
        response.status,
      );
    }
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
      throw new ServiceTokenError('Token endpoint answered without access_token and expires_in');
    }
    const margin = this.options.refreshMarginMs ?? 30_000;
    this.cached = {
      value: body.access_token,
      // Counted from the request, so a slow response cannot stretch the token's life.
      refreshAt: requestedAt + Math.max(0, body.expires_in * 1000 - margin),
    };
    return body.access_token;
  }
}
