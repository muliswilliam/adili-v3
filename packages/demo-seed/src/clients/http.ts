/** Small JSON-over-HTTP helpers for the endpoints with no generated client (mocks, Keycloak). */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    super(`${what}: ${String(status)} ${body.slice(0, 500)}`);
  }
}

/**
 * `fetch` that rides out a service restarting under it (a dev watcher reloading, a container
 * recreated): network errors and 502/503/504 are retried with backoff, up to about 30 s. Every
 * request the seed retries is safe to repeat: reads, writes carrying their Idempotency-Key, and
 * writes the service answers the same way twice (starting a declaration returns the draft there
 * is, an amendment in progress is answered as it is, a second onboarding session is harmless).
 */
export async function resilientFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const request = input instanceof Request ? input.clone() : input;
      const response = await fetch(request, init);
      if (![502, 503, 504].includes(response.status) || attempt >= 8) return response;
    } catch (error) {
      if (attempt >= 8) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** attempt, 8000)));
  }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the body's type
export async function requestJson<T>(
  url: string,
  init: Omit<RequestInit, 'headers'> & {
    what: string;
    allow?: readonly number[];
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: T }> {
  const response = await resilientFetch(url, {
    ...init,
    headers: { accept: 'application/json', ...init.headers },
  });
  const text = await response.text();
  if (!response.ok && !(init.allow ?? []).includes(response.status)) {
    throw new HttpError(response.status, text, init.what);
  }
  const json = (response.headers.get('content-type') ?? '').includes('json');
  return { status: response.status, body: (json && text ? JSON.parse(text) : null) as T };
}

export function jsonBody(body: unknown): { body: string; headers: Record<string, string> } {
  return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
}

/** Waits until `check` returns a value, polling every `intervalMs`, or throws after `timeoutMs`. */
export async function waitFor<T>(
  what: string,
  check: () => Promise<T | undefined>,
  { timeoutMs = 60_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out after ${String(timeoutMs)} ms: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Runs `work` over `items` with at most `limit` in flight; results keep the items' order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}
