/** A fetch as a client calls it: the request, plus an init it may add to. */
export type SendRequest = (request: Request, init: RequestInit) => Promise<Response>;

/** A request's time allowance in ms: one for every request, or chosen per request. */
export type RequestTimeout = number | ((request: Request) => number);

/**
 * `send`, bounded by a deadline per request: the request is aborted when it has no answer within
 * `timeoutMs`, or when the caller aborts it through the request's own signal (a cancelled loader).
 * The combined signal goes to fetch itself, in its init: a signal held only by a Request (which
 * follows it through a weak reference) can be garbage collected before it fires, and the call
 * then waits for the server whatever the timeout. The init's signal replaces the request's, so
 * both are combined into it.
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
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(typeof timeoutMs === 'number' ? timeoutMs : timeoutMs(request)),
      ]),
    });
}
