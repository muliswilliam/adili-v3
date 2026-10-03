type Send = (request: Request, init: RequestInit) => Promise<Response>;

interface Entry {
  status: number;
  headers: [string, string][];
  body: ArrayBuffer;
  etag: string | null;
  freshUntil: number;
}

export interface PublicCacheOptions {
  now?: () => number;
  /** Copies kept; the least recently used goes first. */
  maxEntries?: number;
}

const MAX_AGE = /(?:^|,)\s*max-age=(\d+)/i;

/**
 * An HTTP cache in front of the public open-data API, for the portal's server. The API limits
 * requests per client IP, and every visitor's page is loaded from the portal's one address, so
 * the portal must not ask once per visitor: it keeps each GET's 200 for as long as
 * `Cache-Control: max-age` allows, then revalidates with `If-None-Match` (a 304 keeps the copy).
 * Releases change only by status, so the API's hour suits. Errors and 429s are never kept.
 * Copies are keyed by URL and Accept, as the API varies by Accept.
 */
export function publicCache(send: Send, options: PublicCacheOptions = {}): Send {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 500;
  const entries = new Map<string, Entry>();

  const respond = (entry: Entry) =>
    new Response(entry.body.slice(0), { status: entry.status, headers: entry.headers });

  const keep = (key: string, entry: Entry) => {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return async (request, init) => {
    if (request.method !== 'GET') return send(request, init);
    const key = `${request.headers.get('accept') ?? ''} ${request.url}`;
    const cached = entries.get(key);
    if (cached && cached.freshUntil > now()) {
      keep(key, cached);
      return respond(cached);
    }
    if (cached?.etag) request.headers.set('if-none-match', cached.etag);
    const response = await send(request, init);
    if (cached && response.status === 304) {
      const renewed = { ...cached, freshUntil: now() + maxAgeMs(response, cached) };
      keep(key, renewed);
      return respond(renewed);
    }
    if (response.status !== 200) return response;
    const entry: Entry = {
      status: 200,
      headers: [...response.headers.entries()],
      body: await response.arrayBuffer(),
      etag: response.headers.get('etag'),
      freshUntil: 0,
    };
    entry.freshUntil = now() + maxAgeMs(response, entry);
    keep(key, entry);
    return respond(entry);
  };
}

/** The response's `max-age` in ms, else the copy's own, else 0 (revalidate every time). */
function maxAgeMs(response: Response, fallback: Entry): number {
  const header =
    response.headers.get('cache-control') ??
    fallback.headers.find(([name]) => name === 'cache-control')?.[1] ??
    '';
  const seconds = MAX_AGE.exec(header)?.[1];
  return seconds === undefined ? 0 : Number(seconds) * 1000;
}
