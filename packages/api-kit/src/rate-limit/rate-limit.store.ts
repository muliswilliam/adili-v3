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

/**
 * Refills `bucket` for the time elapsed since it was last updated and takes one token if there
 * is one. A missing bucket is a full one. Stores implement exactly this, atomically per key.
 */
export function takeToken(
  bucket: TokenBucket | undefined,
  policy: RateLimitPolicy,
  nowMs: number,
): { bucket: TokenBucket; decision: RateLimitDecision } {
  const { limit } = policy;
  const tokensPerMs = limit / (policy.windowSeconds * 1000);
  const elapsedMs = bucket ? Math.max(0, nowMs - bucket.updatedAtMs) : 0;
  let tokens = bucket ? Math.min(limit, bucket.tokens + elapsedMs * tokensPerMs) : limit;
  const allowed = tokens >= 1;
  if (allowed) {
    tokens -= 1;
  }
  return {
    bucket: { tokens, updatedAtMs: nowMs },
    decision: {
      allowed,
      limit,
      remaining: Math.floor(tokens),
      resetSeconds: Math.ceil((limit - tokens) / tokensPerMs / 1000),
      retryAfterSeconds: allowed ? 0 : Math.ceil((1 - tokens) / tokensPerMs / 1000),
    },
  };
}

/** Persistence for `@RateLimit()` buckets, shared by every replica of a service. */
export abstract class RateLimitStore {
  /** Atomically applies `takeToken` to the bucket under `key`. */
  abstract consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision>;
}
