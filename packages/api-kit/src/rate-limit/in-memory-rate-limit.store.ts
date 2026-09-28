import {
  type ConsumeOptions,
  type RateLimitDecision,
  type RateLimitPolicy,
  RateLimitStore,
  takeToken,
  type TokenBucket,
} from './rate-limit.store.js';

export interface InMemoryRateLimitStoreOptions {
  /** Clock in epoch milliseconds when the caller passes none (see `RATE_LIMIT_CLOCK`). */
  now?: () => number;
}

/**
 * Process-local store for tests that run without Valkey. Same semantics as
 * `ValkeyRateLimitStore` from `@adili/cache`, but each replica counts on its own.
 */
export class InMemoryRateLimitStore extends RateLimitStore {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly now: () => number;

  constructor(options: InMemoryRateLimitStoreOptions = {}) {
    super();
    this.now = options.now ?? Date.now;
  }

  consume(
    key: string,
    policy: RateLimitPolicy,
    { cost = 1, nowMs = this.now() }: ConsumeOptions = {},
  ): Promise<RateLimitDecision> {
    const { bucket, decision } = takeToken(this.buckets.get(key), policy, nowMs, cost);
    this.buckets.set(key, bucket);
    return Promise.resolve(decision);
  }
}
