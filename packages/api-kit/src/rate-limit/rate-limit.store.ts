/**
 * A sliding window: at most `limit` requests in any `windowSeconds`. A request counts for exactly
 * `windowSeconds` after it was made, so "5 per 15 minutes" means the sixth request within any
 * 15 minutes is refused, however the first five were spread.
 */
export interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
}

/** The outcome of counting one request against a window, as the client is told in headers. */
export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  /** Requests left in the window after this one. */
  remaining: number;
  /** Seconds until every request now counted has left the window (the budget is full again). */
  resetSeconds: number;
  /** Seconds until the next request would be allowed; 0 when this one was. */
  retryAfterSeconds: number;
}

/**
 * Counts a request made at `nowMs` against `log`, the times (epoch milliseconds, ascending) of
 * the requests counted under one key so far. Requests at or before `nowMs - window` have left
 * the window and are dropped. A request is allowed while fewer than `limit` remain, and then
 * joins the log; a refused one does not. A negative `cost` gives back that many of the latest
 * requests (a request refunded because of its outcome) and is always allowed. Stores implement
 * exactly this, atomically per key.
 */
export function countRequest(
  log: readonly number[] | undefined,
  policy: RateLimitPolicy,
  nowMs: number,
  cost = 1,
): { log: number[]; decision: RateLimitDecision } {
  const { limit } = policy;
  const windowMs = policy.windowSeconds * 1000;
  const live = (log ?? []).filter((time) => time > nowMs - windowMs);
  let allowed = true;
  if (cost > 0) {
    allowed = live.length + cost <= limit;
    if (allowed) live.push(...Array<number>(cost).fill(nowMs));
  } else if (cost < 0) {
    live.splice(Math.max(0, live.length + cost));
  }
  const newest = live.at(-1);
  // The latest of the requests that must leave the window before `cost` more fit.
  const blocking = allowed ? undefined : live[live.length + cost - limit - 1];
  return {
    log: live,
    decision: {
      allowed,
      limit,
      remaining: Math.max(0, limit - live.length),
      resetSeconds: newest === undefined ? 0 : secondsUntil(newest + windowMs, nowMs),
      retryAfterSeconds: blocking === undefined ? 0 : secondsUntil(blocking + windowMs, nowMs),
    },
  };
}

function secondsUntil(timeMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((timeMs - nowMs) / 1000));
}

/** Epoch milliseconds. */
export type RateLimitClock = () => number;

/**
 * Injection token of the clock rate limit windows are computed with: `null` (the default) lets
 * the store use its own, e.g. the Valkey server's time. Tests replace it to exercise windows
 * sliding on without waiting: `.overrideProvider(RATE_LIMIT_CLOCK).useValue(() => now)`.
 */
export const RATE_LIMIT_CLOCK = Symbol('RATE_LIMIT_CLOCK');

export interface ConsumeOptions {
  /** 1 (the default) to count a request, -1 to give a request back. */
  cost?: number;
  /** The time to compute the window at; the store's own clock when absent. */
  nowMs?: number;
}

/** Persistence for `@RateLimit()` windows, shared by every replica of a service. */
export abstract class RateLimitStore {
  /** Atomically applies `countRequest` to the log under `key`. */
  abstract consume(
    key: string,
    policy: RateLimitPolicy,
    options?: ConsumeOptions,
  ): Promise<RateLimitDecision>;
}
