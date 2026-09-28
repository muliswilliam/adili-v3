import createClient, { type Client } from 'openapi-fetch';

import { type ServiceTokenClient, ServiceTokenError } from './auth/service-token-client.js';

/** How long a synchronous call to another service may take by default (ADR-013 §2). */
export const SERVICE_CALL_TIMEOUT_MS = 2_000;

export interface ServiceClientOptions {
  /** Base URL of the service called, e.g. `http://localhost:4006`. */
  baseUrl: string;
  /** Client credentials tokens of the calling service, with the scopes the callee requires. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /**
   * Per attempt. Default `SERVICE_CALL_TIMEOUT_MS` (2 s); a longer one is an exception to record
   * in ADR-013's list of synchronous budgets.
   */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/**
 * The call did not get an answer: no service token, the callee unreachable, or no answer within
 * the timeout. Callers map it to their own "unavailable" (typically 502 or 503 to their caller).
 * An answer of any status is not this: read it from the response.
 */
export class ServiceCallFailed extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`Service call failed: ${reason}`, options);
    this.name = 'ServiceCallFailed';
  }
}

/**
 * Whether a call through a service client got no usable answer: `ServiceCallFailed`, or a
 * success whose body is not JSON (openapi-fetch's `SyntaxError`). Callers map both to their
 * "unavailable", and let any other error (a bug) through.
 */
export function isUnanswered(error: unknown): error is Error {
  return error instanceof ServiceCallFailed || error instanceof SyntaxError;
}

/**
 * A typed client for another service's internal API (ADR-013 §2), generated from its contract
 * (`openapi-typescript` → `paths`), that calls as the calling service itself (ADR-013 §5):
 *
 * - every request carries a client credentials token from `tokens`; a 401 answer drops the
 *   cached token and the request is sent once more with a fresh one (the callee's keys rotated
 *   or the token was revoked);
 * - every attempt is bounded by `timeoutMs`;
 * - no token, no connection or no answer in time throw `ServiceCallFailed` (see `isUnanswered`).
 *
 * Validate what the callee answers with Zod before use: the generated types describe the
 * contract, not what arrived.
 *
 * @example
 * const gateway = createServiceClient<paths>({ baseUrl, tokens });
 * const { data, response } = await gateway.POST('/internal/v1/iprs/person-lookups', { body });
 */
export function createServiceClient<Paths extends object>(
  options: ServiceClientOptions,
): Client<Paths> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? SERVICE_CALL_TIMEOUT_MS;

  const attempt = async (request: Request): Promise<Response> => {
    let token: string;
    try {
      token = await options.tokens.token();
    } catch (error) {
      if (error instanceof ServiceTokenError) {
        throw new ServiceCallFailed('no service token', { cause: error });
      }
      throw error;
    }
    const headers = new Headers(request.headers);
    headers.set('authorization', `Bearer ${token}`);
    try {
      return await fetchImpl(
        new Request(request, { headers, signal: AbortSignal.timeout(timeoutMs) }),
      );
    } catch (error) {
      throw new ServiceCallFailed(`${request.method} ${new URL(request.url).pathname} unanswered`, {
        cause: error,
      });
    }
  };

  return createClient<Paths>({
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    headers: { accept: 'application/json' },
    fetch: async (request) => {
      const retry = request.clone();
      const response = await attempt(request);
      if (response.status !== 401) return response;
      options.tokens.invalidate();
      await response.body?.cancel();
      return attempt(retry);
    },
  });
}
