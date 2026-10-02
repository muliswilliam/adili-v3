import { stdSerializers } from 'pino';

/**
 * Query params that carry free text a person typed (e.g. a declarant name in the review
 * queue search). The architecture rule is no PII in URLs or logs, and GET search endpoints
 * put it in the URL, so request logging blanks these values.
 */
const FREE_TEXT_PARAMS: ReadonlySet<string> = new Set([
  'search',
  'q',
  'query',
  'name',
  'email',
  'phone',
]);

export const REDACTED = '[redacted]';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Replaces the value of free-text query params in a request URL; path and other params are kept. */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  const hashStart = url.indexOf('#', queryStart);
  const queryEnd = hashStart === -1 ? url.length : hashStart;
  const query = url
    .slice(queryStart + 1, queryEnd)
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=');
      if (separator === -1) return pair;
      const key = safeDecode(pair.slice(0, separator).replaceAll('+', ' '));
      return FREE_TEXT_PARAMS.has(key.toLowerCase())
        ? `${pair.slice(0, separator)}=${REDACTED}`
        : pair;
    })
    .join('&');
  return `${url.slice(0, queryStart + 1)}${query}${url.slice(queryEnd)}`;
}

function redactQuery(query: unknown): unknown {
  if (typeof query !== 'object' || query === null) return query;
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      FREE_TEXT_PARAMS.has(key.toLowerCase()) ? REDACTED : value,
    ]),
  );
}

/** pino `req` serializer: the standard one, with free-text query values redacted. */
export function serializeRequest(request: Parameters<typeof stdSerializers.req>[0]) {
  const serialized = stdSerializers.req(request);
  return {
    ...serialized,
    url: typeof serialized.url === 'string' ? redactUrl(serialized.url) : serialized.url,
    ...('query' in serialized ? { query: redactQuery(serialized.query) } : {}),
  };
}
