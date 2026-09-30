import createClient, { type Client } from 'openapi-fetch';

/** A service mock's fetch: takes the client's request, answers it in memory. */
export type MockFetch = (request: Request) => Promise<Response>;

export interface MockableClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  /**
   * The in-memory mock to answer instead of the service, or null for the real one. Build it at
   * the call site as `import.meta.env.DEV && <flag> ? <lazy import of ./mock.server> : null`,
   * written out inline: `import.meta.env.DEV` is `false` in production builds, so the bundler
   * drops that branch and the mock's chunk with it, which it cannot see through this function.
   */
  mock: MockFetch | null;
}

/**
 * A typed openapi-fetch client for a service, with a timeout on every request, that can talk
 * to the service's in-memory mock in local development and tests. The mock stays off under
 * NODE_ENV=production even if a development build were started with production settings.
 */
export function mockableClient<Paths extends object>({
  baseUrl,
  headers = {},
  timeoutMs,
  mock,
}: MockableClientOptions): Client<Paths> {
  const send: (request: Request, init: RequestInit) => Promise<Response> =
    mock && process.env.NODE_ENV !== 'production' ? mock : fetch;
  return createClient<Paths>({
    baseUrl,
    headers: { accept: 'application/json', ...headers },
    // The deadline goes to fetch itself: held only by a Request, a timeout signal can be
    // garbage collected before it fires.
    fetch: (request) => send(request, { signal: AbortSignal.timeout(timeoutMs) }),
  });
}
