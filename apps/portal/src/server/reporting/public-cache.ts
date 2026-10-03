type Send = (request: Request, init: RequestInit) => Promise<Response>;

/** An answer read whole, so any number of callers can each be given a Response of it. */
interface Snapshot {
  status: number;
  headers: [string, string][];
  body: ArrayBuffer;
}

interface Entry extends Snapshot {
  etag: string | null;
  freshUntil: number;
}

export interface PublicCacheOptions {
  now?: () => number;
  /** Copies kept; the least recently used goes first. */
  maxEntries?: number;
  /**
   * The longest a URL's copy is trusted, below the API's `max-age`: e.g. the list of releases,
   * so a release EACC publishes or withdraws shows within a minute. Undefined keeps `max-age`.
   */
  maxAgeCapMs?: (url: string) => number | undefined;
}

const MAX_AGE = /(?:^|,)\s*max-age=(\d+)/i;

/**
 * An HTTP cache in front of the public open-data API, for the portal's server. The API limits
 * requests per client IP, and every visitor's page is loaded from the portal's one address, so
 * the portal must not ask once per visitor: it keeps each GET's 200 for as long as
 * `Cache-Control: max-age` allows (or `maxAgeCapMs`), then revalidates with `If-None-Match` (a
 * 304 keeps the copy). Concurrent requests for the same copy share one request to the API, a
 * first fetch and a revalidation alike, so a burst of visitors on a cold or stale cache costs
 * one request per file. Errors and 429s are never kept; with a stale copy at hand they are
 * answered with it. Copies are keyed by URL and Accept, as the API varies by Accept.
 */
export function publicCache(send: Send, options: PublicCacheOptions = {}): Send {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 500;
  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<Snapshot>>();

  const respond = (snapshot: Snapshot) =>
    new Response(snapshot.body.slice(0), { status: snapshot.status, headers: snapshot.headers });

  const keep = (key: string, entry: Entry) => {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  const freshFor = (url: string, response: Response, fallback?: Snapshot) => {
    const maxAge = maxAgeMs(response, fallback);
    const cap = options.maxAgeCapMs?.(url);
    return now() + (cap === undefined ? maxAge : Math.min(maxAge, cap));
  };

  /** Asks the API once for a key, keeping or renewing the copy, and reads the answer whole. */
  const fetchOnce = async (key: string, request: Request, init: RequestInit): Promise<Snapshot> => {
    const cached = entries.get(key);
    if (cached?.etag) request.headers.set('if-none-match', cached.etag);
    let response: Response;
    try {
      response = await send(request, init);
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
    if (cached && response.status === 304) {
      const renewed = { ...cached, freshUntil: freshFor(request.url, response, cached) };
      keep(key, renewed);
      return renewed;
    }
    // Stale beats nothing when the API limits the portal or is down (stale-if-error): the
    // figures only change when EACC publishes or withdraws. The copy stays stale, so the next
    // request asks again.
    if (cached && (response.status === 429 || response.status >= 500)) return cached;
    const snapshot: Snapshot = {
      status: response.status,
      headers: [...response.headers.entries()],
      body: await response.arrayBuffer(),
    };
    if (response.status === 200) {
      keep(key, {
        ...snapshot,
        etag: response.headers.get('etag'),
        freshUntil: freshFor(request.url, response),
      });
    }
    return snapshot;
  };

  return async (request, init) => {
    if (request.method !== 'GET') return send(request, init);
    const key = `${request.headers.get('accept') ?? ''} ${request.url}`;
    const cached = entries.get(key);
    if (cached && cached.freshUntil > now()) {
      keep(key, cached);
      return respond(cached);
    }
    let pending = inFlight.get(key);
    if (!pending) {
      pending = fetchOnce(key, request, init).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, pending);
    }
    return respond(await pending);
  };
}

/** The response's `max-age` in ms, else the copy's own, else 0 (revalidate every time). */
function maxAgeMs(response: Response, fallback?: Snapshot): number {
  const header =
    response.headers.get('cache-control') ??
    fallback?.headers.find(([name]) => name === 'cache-control')?.[1] ??
    '';
  const seconds = MAX_AGE.exec(header)?.[1];
  return seconds === undefined ? 0 : Number(seconds) * 1000;
}
