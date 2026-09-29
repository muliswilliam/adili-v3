import { ACTING_TENANT_HEADER, type ServiceTokenClient, ServiceTokenError } from '@adili/api-kit';
import type { z } from 'zod';

export interface InternalApiOptions {
  /** Base URL of the service, e.g. `http://localhost:4002`. */
  baseUrl: string;
  /** Names the service in errors, e.g. `declarations`. */
  service: string;
  /** Client credentials tokens of the review service carrying the callee's internal scope. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /** Builds the error thrown when the service cannot be used. */
  unavailable: (message: string, options?: ErrorOptions) => Error;
  /** Per attempt. */
  timeoutMs: number;
  /** For tests. */
  fetch?: typeof fetch;
}

export interface InternalRequest<T> {
  path: string;
  query?: Record<string, string>;
  /** The Commission the call acts for (`X-Acting-Tenant`, ADR-013 §8.1). */
  tenant: string;
  headers?: Record<string, string>;
  /** The success body, validated at the boundary. */
  schema: z.ZodType<T>;
}

export interface InternalPostRequest<T> extends InternalRequest<T> {
  /** Sent as JSON. */
  body: unknown;
}

/**
 * The service refused a write with a 4xx other than 401 and 404: the request itself is wrong
 * (validation, conflict), so sending it again changes nothing. Activities do not retry it.
 */
export class InternalApiRejected extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
  ) {
    super(`The ${service} service refused the request with ${String(status)}`);
    this.name = 'InternalApiRejected';
  }
}

/**
 * Calls on another service's internal API with the review service's own token (client
 * credentials, one retry with a fresh token after a 401) and the Commission in `X-Acting-Tenant`.
 * A success is validated against `schema`; 404 is null; an unreachable service, a 5xx or a body
 * outside the contract is the `unavailable` error, which workflow activities retry. A write
 * refused with another 4xx is `InternalApiRejected`.
 */
export class InternalApi {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: InternalApiOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  /** A GET answered 200. */
  get<T>(request: InternalRequest<T>): Promise<T | null> {
    return this.call(request, 'GET', undefined);
  }

  /** A POST answered 200 or 201. */
  post<T>(request: InternalPostRequest<T>): Promise<T | null> {
    return this.call(request, 'POST', JSON.stringify(request.body));
  }

  private async call<T>(
    request: InternalRequest<T>,
    method: 'GET' | 'POST',
    payload: string | undefined,
  ): Promise<T | null> {
    let response = await this.send(request, method, payload);
    if (response.status === 401) {
      this.options.tokens.invalidate();
      response = await this.send(request, method, payload);
    }
    if (response.status === 404) return null;
    const ok = response.status === 200 || (method === 'POST' && response.status === 201);
    if (!ok && method === 'POST' && response.status >= 400 && response.status < 500) {
      throw new InternalApiRejected(this.options.service, response.status);
    }
    if (!ok) {
      throw this.options.unavailable(
        `The ${this.options.service} service answered ${String(response.status)}`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw this.options.unavailable(`The ${this.options.service} service answered no JSON`, {
        cause: error,
      });
    }
    const parsed = request.schema.safeParse(body);
    if (!parsed.success) {
      throw this.options.unavailable(
        `The ${this.options.service} service answered outside its contract`,
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  private async send(
    request: InternalRequest<unknown>,
    method: 'GET' | 'POST',
    body: string | undefined,
  ): Promise<Response> {
    let token: string;
    try {
      token = await this.options.tokens.token();
    } catch (error) {
      if (error instanceof ServiceTokenError) {
        throw this.options.unavailable(`No service token for the ${this.options.service} service`, {
          cause: error,
        });
      }
      throw error;
    }
    const url = new URL(request.path, this.options.baseUrl.replace(/\/?$/, '/'));
    for (const [name, value] of Object.entries(request.query ?? {})) {
      url.searchParams.set(name, value);
    }
    try {
      return await this.fetch(url, {
        method,
        body,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          authorization: `Bearer ${token}`,
          [ACTING_TENANT_HEADER]: request.tenant,
          ...request.headers,
        },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw this.options.unavailable(`The ${this.options.service} service is unreachable`, {
        cause: error,
      });
    }
  }
}
