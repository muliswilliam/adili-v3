import {
  type RateLimitDecision,
  type RateLimitPolicy,
  RateLimitStore,
  takeToken,
  type TokenBucket,
} from './rate-limit.store.js';

export interface InMemoryRateLimitStoreOptions {
  /** Clock in epoch milliseconds; tests pass their own to exercise refill. */
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

  consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    const { bucket, decision } = takeToken(this.buckets.get(key), policy, this.now());
    this.buckets.set(key, bucket);
    return Promise.resolve(decision);
  }
}
