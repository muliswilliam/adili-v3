import {
  type ConsumeOptions,
  countRequest,
  type RateLimitDecision,
  type RateLimitPolicy,
  RateLimitStore,
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
  private readonly logs = new Map<string, number[]>();
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
    const { log, decision } = countRequest(this.logs.get(key), policy, nowMs, cost);
    if (log.length > 0) this.logs.set(key, log);
    else this.logs.delete(key);
    return Promise.resolve(decision);
  }
}
