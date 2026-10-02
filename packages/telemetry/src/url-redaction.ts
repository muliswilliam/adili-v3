/**
 * Query params that carry free text a person typed (e.g. a declarant name in the review
 * queue search). The architecture rule is no PII in URLs, logs or traces: endpoints take such
 * text in a body (the queue's `searchReviewQueue`), and as a safety net request logs and trace
 * attributes blank these values wherever a URL still carries them.
 */
export const FREE_TEXT_PARAMS: ReadonlySet<string> = new Set([
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
  const query = redactQuery(url.slice(queryStart + 1, queryEnd), { identifiers: false });
  return `${url.slice(0, queryStart + 1)}${query}${url.slice(queryEnd)}`;
}

/** A UUID: a row's own key, never a person's. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A word of an API: lower case, digits, `.`, `_`, `~` and `-` (`v1`, `tenant-psc`, `.well-known`). */
const WORD = /^[a-z0-9._~-]+$/;
/** A query key: a word of the API, in any case (`id_number`, `employerCode`). */
const KEY = /^[a-z0-9._~-]+$/i;
/**
 * Five digits, together or apart: national IDs (5 to 10 digits), KRA PINs, phone and personal
 * numbers, written plain or with separators (`0712-345-678`), and dates.
 */
const MANY_DIGITS = /(?:[0-9][^0-9]*){5}/;

/**
 * Whether a path segment or query value, as it appears in the URL, is plainly a word of the API
 * rather than an identifier. An allow-list, so identifiers of shapes no one listed are blanked
 * too: anything with upper case (`A002260778R`), an escape (`KEMSA%2F2011%2F0457`) or five digits
 * (`22607781`) is redacted; UUIDs, short numbers and lower-case words are kept.
 */
function isApiWord(value: string): boolean {
  return value === '' || UUID.test(value) || (WORD.test(value) && !MANY_DIGITS.test(value));
}

const isQueryKey = (key: string) => key === '' || (KEY.test(key) && !MANY_DIGITS.test(key));

/**
 * A query (without its `?`) with free-text values blanked and, with `identifiers`, every value
 * that is not plainly a word of the API, and every pair whose key is not, too.
 */
function redactQuery(query: string, { identifiers }: { identifiers: boolean }): string {
  return query
    .split('&')
    .map((pair) => {
      const separator = pair.indexOf('=');
      const rawKey = separator === -1 ? pair : pair.slice(0, separator);
      if (identifiers && !isQueryKey(rawKey)) return REDACTED;
      if (separator === -1) return pair;
      const key = safeDecode(rawKey.replaceAll('+', ' ')).toLowerCase();
      const value = pair.slice(separator + 1);
      return FREE_TEXT_PARAMS.has(key) || (identifiers && !isApiWord(value))
        ? `${rawKey}=${REDACTED}`
        : pair;
    })
    .join('&');
}

/** `scheme://authority`, kept as it is: hosts and ports name services, not people. */
const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

/**
 * A request URL as a trace may carry it: free-text query values blanked as in `redactUrl`, and
 * every path segment, query value and query key that is not plainly a word of the API
 * (`isApiWord`) too, so a trace shows the shape of each call but no identifier in it. Takes a
 * full URL or a path with its query; hosts and ports are kept.
 */
export function redactTracedUrl(url: string): string {
  const origin = ORIGIN.exec(url)?.[0] ?? '';
  const rest = url.slice(origin.length);
  const hashStart = rest.indexOf('#');
  const beforeHash = hashStart === -1 ? rest : rest.slice(0, hashStart);
  const queryStart = beforeHash.indexOf('?');
  const path = (queryStart === -1 ? beforeHash : beforeHash.slice(0, queryStart))
    .split('/')
    .map((segment) => (isApiWord(segment) ? segment : REDACTED))
    .join('/');
  const query =
    queryStart === -1
      ? ''
      : `?${redactQuery(beforeHash.slice(queryStart + 1), { identifiers: true })}`;
  const hash = hashStart === -1 ? null : rest.slice(hashStart + 1);
  const fragment = hash === null ? '' : `#${isApiWord(hash) ? hash : REDACTED}`;
  return `${origin}${path}${query}${fragment}`;
}
