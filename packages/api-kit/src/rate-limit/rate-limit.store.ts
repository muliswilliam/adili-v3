/**
 * A token bucket: it holds up to `limit` requests and refills continuously at `limit` per
 * `windowSeconds`, so a client may burst `limit` requests and then sustain the average rate.
 */
export interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
}

/** The outcome of taking one request from a bucket, as the client is told in headers. */
export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  /** Whole requests left in the bucket after this one. */
  remaining: number;
  /** Seconds until the bucket is full again. */
  resetSeconds: number;
  /** Seconds until the next request would be allowed; 0 when this one was. */
  retryAfterSeconds: number;
}

/** Bucket state as stored between requests. */
export interface TokenBucket {
  tokens: number;
  updatedAtMs: number;
}

/** Tolerance of token arithmetic: far below one request, far above rounding error. */
export const TOKEN_EPSILON = 1e-6;

/**
 * Refills `bucket` for the time elapsed since it was last updated, then takes `cost` tokens if
 * the bucket holds them. A negative cost gives tokens back (up to the limit) and is always
 * allowed: a request refunded because of its outcome. A missing bucket is a full one. Stores
 * implement exactly this, atomically per key.
 */
export function takeToken(
  bucket: TokenBucket | undefined,
  policy: RateLimitPolicy,
  nowMs: number,
  cost = 1,
): { bucket: TokenBucket; decision: RateLimitDecision } {
  const { limit } = policy;
  const tokensPerMs = limit / (policy.windowSeconds * 1000);
  const elapsedMs = bucket ? Math.max(0, nowMs - bucket.updatedAtMs) : 0;
  let tokens = bucket ? Math.min(limit, bucket.tokens + elapsedMs * tokensPerMs) : limit;
  // Refills accumulate in floating point (and Valkey stores them as text), so a bucket waited
  // on for exactly `retryAfterSeconds` may hold 0.9999999 tokens: count that as the token.
  const allowed = tokens + TOKEN_EPSILON >= cost;
  if (allowed) {
    tokens = Math.max(0, Math.min(limit, tokens - cost));
  }
  return {
    bucket: { tokens, updatedAtMs: nowMs },
    decision: {
      allowed,
      limit,
      remaining: Math.floor(tokens),
      resetSeconds: Math.ceil((limit - tokens) / tokensPerMs / 1000),
      retryAfterSeconds: allowed ? 0 : Math.ceil((cost - tokens) / tokensPerMs / 1000),
    },
  };
}

/** Epoch milliseconds. */
export type RateLimitClock = () => number;

/**
 * Injection token of the clock rate limit buckets are computed with: `null` (the default) lets
 * the store use its own, e.g. the Valkey server's time. Tests replace it to exercise refills
 * and resets without waiting: `.overrideProvider(RATE_LIMIT_CLOCK).useValue(() => now)`.
 */
export const RATE_LIMIT_CLOCK = Symbol('RATE_LIMIT_CLOCK');

export interface ConsumeOptions {
  /** Tokens to take: 1 (the default) for a request, -1 to give a request's token back. */
  cost?: number;
  /** The time to compute the bucket at; the store's own clock when absent. */
  nowMs?: number;
}

/** Persistence for `@RateLimit()` buckets, shared by every replica of a service. */
export abstract class RateLimitStore {
  /** Atomically applies `takeToken` to the bucket under `key`. */
  abstract consume(
    key: string,
    policy: RateLimitPolicy,
    options?: ConsumeOptions,
  ): Promise<RateLimitDecision>;
}
