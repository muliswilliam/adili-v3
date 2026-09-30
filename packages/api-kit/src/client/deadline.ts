/** A fetch as a client calls it: the request, plus an init it may add to. */
export type SendRequest = (request: Request, init: RequestInit) => Promise<Response>;

/** A request's time allowance in ms: one for every request, or chosen per request. */
export type RequestTimeout = number | ((request: Request) => number);

/**
 * `send`, bounded by a deadline per request: the request is aborted when it has no answer within
 * `timeoutMs`. The timeout signal goes to fetch itself, in its init: a signal held only by a
 * Request (which follows it through a weak reference) can be garbage collected before it fires,
 * and the call then waits for the server whatever the timeout.
 *
 * @example
 * createClient<paths>({ baseUrl, fetch: withDeadline(fetch, 5_000) });
 */
export function withDeadline(
  send: SendRequest,
  timeoutMs: RequestTimeout,
): (request: Request) => Promise<Response> {
  return (request) =>
    send(request, {
      signal: AbortSignal.timeout(typeof timeoutMs === 'number' ? timeoutMs : timeoutMs(request)),
    });
}
