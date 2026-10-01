import createClient, { type Client } from 'openapi-fetch';

import { type RequestTimeout, type SendRequest, withDeadline } from './deadline.js';

/**
 * A service mock's fetch: takes the client's request and answers it in memory. The init carries
 * the request's deadline, for a mock that passes some requests on to the real service.
 */
export type MockFetch = (request: Request, init: RequestInit) => Promise<Response>;

export interface MockableClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  /** Per request; a function chooses it from the request (e.g. longer for uploads). */
  timeoutMs: RequestTimeout;
  /**
   * The in-memory mock to answer instead of the service, or null (the default) for the real one.
   * In an app, build it at the call site as
   * `import.meta.env.DEV && <flag> ? <lazy import of ./mock.server> : null`, written out inline:
   * `import.meta.env.DEV` is `false` in production builds, so the bundler drops that branch and
   * the mock's chunk with it, which it cannot see through this function.
   */
  mock?: MockFetch | null;
  /** The fetch for the real service; for tests. */
  fetch?: typeof fetch;
}

/**
 * A typed openapi-fetch client for a service, with a deadline on every request (`withDeadline`),
 * that can talk to the service's in-memory mock in local development and tests. The mock stays
 * off under NODE_ENV=production even if a development build were started with production
 * settings.
 */
export function mockableClient<Paths extends object>({
  baseUrl,
  headers = {},
  timeoutMs,
  mock = null,
  fetch: fetchImpl,
}: MockableClientOptions): Client<Paths> {
  const send: SendRequest =
    mock && process.env.NODE_ENV !== 'production'
      ? mock
      : (request, init) => (fetchImpl ?? fetch)(request, init);
  return createClient<Paths>({
    baseUrl,
    headers: { accept: 'application/json', ...headers },
    fetch: withDeadline(send, timeoutMs),
  });
}
