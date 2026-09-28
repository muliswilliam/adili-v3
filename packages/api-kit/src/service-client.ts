import createClient, { type Client } from 'openapi-fetch';
import type { z } from 'zod';

import { type ServiceTokenClient, ServiceTokenError } from './auth/service-token-client.js';

/** How long a synchronous call to another service may take by default (ADR-013 §2). */
export const SERVICE_CALL_TIMEOUT_MS = 2_000;

export interface ServiceClientOptions {
  /** Base URL of the service called, e.g. `http://localhost:4006`. */
  baseUrl: string;
  /** The service called, as error messages name it, e.g. `the integration-gateway`. */
  service: string;
  /** Client credentials tokens of the calling service, with the scopes the callee requires. */
  tokens: Pick<ServiceTokenClient, 'token' | 'invalidate'>;
  /**
   * The caller's own "unavailable" error (typically mapped to 502 or 503 for its caller), thrown
   * for every answer the caller did not expect; see `ServiceClient.call`.
   */
  unavailable: (message: string, options?: ErrorOptions) => Error;
  /**
   * Per attempt. Default `SERVICE_CALL_TIMEOUT_MS` (2 s); a longer one is an exception to record
   * in ADR-013's list of synchronous budgets.
   */
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** What `ServiceClient.call` reads of an openapi-fetch result. */
export interface ServiceAnswer {
  data?: unknown;
  response: Response;
}

export interface ExpectedAnswer<T, R> {
  /** The status that carries the answer asked for... */
  status: number;
  /** ...and its body, validated before use: the generated types describe the contract, not what arrived. */
  schema: z.ZodType<T>;
  /**
   * Other statuses that mean something to the caller (e.g. 404, no such thing), each answered by
   * its handler, which returns a result or throws the caller's own error.
   */
  otherwise?: Readonly<Record<number, (response: Response) => R>>;
}

/** A typed client for another service's internal API; see `createServiceClient`. */
export interface ServiceClient<Paths extends object> {
  /**
   * Sends the request built with the generated client and reads its answer: the expected status
   * with a body that passes the schema is the result, a status in `otherwise` is its handler's.
   * Everything else throws the caller's `unavailable` error: no token, the callee unreachable, no
   * answer in time, a body that is not JSON, any other status, or a body that breaks the contract.
   */
  call<T, R = never>(
    request: (api: Client<Paths>) => Promise<ServiceAnswer>,
    expected: ExpectedAnswer<T, R>,
  ): Promise<T | R>;
}

/**
 * The call did not get an answer: no service token, the callee unreachable, or no answer within
 * the timeout. `ServiceClient.call` turns it into the caller's `unavailable` error.
 */
export class ServiceCallFailed extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`Service call failed: ${reason}`, options);
    this.name = 'ServiceCallFailed';
  }
}

/**
 * A client for another service's internal API (ADR-013 §2), typed by the `paths` generated from
 * its contract (`openapi-typescript`), that calls as the calling service itself (ADR-013 §5):
 *
 * - every request carries a client credentials token from `tokens`; a 401 answer drops the
 *   cached token and the request is sent once more with a fresh one (the callee's keys rotated
 *   or the token was revoked);
 * - every attempt is bounded by `timeoutMs`;
 * - `call` validates the answer and maps whatever the caller did not expect to its own
 *   `unavailable` error, so each adapter states only what it expects.
 *
 * @example
 * const gateway = createServiceClient<paths>({
 *   baseUrl, service: 'the integration-gateway', tokens, unavailable: (m, o) => new IprsUnavailable(m, o),
 * });
 * const person = await gateway.call(
 *   (api) => api.POST('/internal/v1/iprs/person-lookups', { body }),
 *   { status: 200, schema: personSchema, otherwise: { 404: () => null } },
 * );
 */
export function createServiceClient<Paths extends object>(
  options: ServiceClientOptions,
): ServiceClient<Paths> {
  const api = createAuthenticatedClient<Paths>(options);
  const { service, unavailable } = options;

  return {
    async call(request, expected) {
      let answer: ServiceAnswer;
      try {
        answer = await request(api);
      } catch (error) {
        // A success whose body is not JSON surfaces from openapi-fetch as a SyntaxError.
        if (error instanceof ServiceCallFailed || error instanceof SyntaxError) {
          throw unavailable(`${service} did not answer`, { cause: error });
        }
        throw error;
      }
      const { data, response } = answer;
      const handler = expected.otherwise?.[response.status];
      if (handler) return handler(response);
      if (response.status !== expected.status) {
        throw unavailable(`${service} answered ${String(response.status)}`);
      }
      const parsed = expected.schema.safeParse(data);
      if (!parsed.success) {
        throw unavailable(`${service} answered a body that breaks its contract`, {
          cause: parsed.error,
        });
      }
      return parsed.data;
    },
  };
}

/** The generated client with the service token, the retry after a 401 and the timeout. */
function createAuthenticatedClient<Paths extends object>(
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
