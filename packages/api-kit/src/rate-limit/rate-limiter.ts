import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  RATE_LIMIT_CLOCK,
  type RateLimitClock,
  type RateLimitDecision,
  type RateLimitPolicy,
  RateLimitStore,
} from './rate-limit.store.js';

/** Injection token of the configured policies, by route group. */
export const RATE_LIMIT_POLICIES = Symbol('RATE_LIMIT_POLICIES');

/** A request counted against one caller's budget of one group, as `refund` takes it back. */
export interface RateLimitCharge {
  group: string;
  key: string;
  policy: RateLimitPolicy;
  decision: RateLimitDecision;
}

/**
 * The budgets behind `@RateLimit`, for code that charges them itself: `RateLimitGuard` for each
 * request, or a service penalising an outcome against a route's budget, e.g. a declarant who
 * ran out of one-time codes using up an identify attempt of their IP.
 *
 * A caller is the string a `RateLimitKey` makes (`byClientIp(request)`), so a charge here and a
 * `@RateLimit` route with that key draw on the same budget. If the store is down, nothing is
 * counted and `consume` answers null rather than failing.
 */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);

  constructor(
    private readonly store: RateLimitStore,
    @Inject(RATE_LIMIT_POLICIES) private readonly policies: Record<string, RateLimitPolicy>,
    @Inject(RATE_LIMIT_CLOCK) private readonly clock: RateLimitClock | null,
  ) {}

  /**
   * Counts one request of `caller` against `group`'s budget. The decision says whether it fit:
   * a refused request is not counted. Throws when `group` has no configured policy.
   */
  async consume(group: string, caller: string): Promise<RateLimitCharge | null> {
    const policy = this.policies[group];
    if (!policy) throw new Error(`No rate limit configured for group "${group}"`);
    const key = `rate-limit:${group}:${caller}`;
    try {
      const decision = await this.store.consume(key, policy, this.at());
      return { group, key, policy, decision };
    } catch (error) {
      this.logger.warn({ err: error, group }, 'Rate limit store unavailable; request not limited');
      return null;
    }
  }

  /** Gives back a counted request; the budget as it now stands, or null if the store is down. */
  async refund(charge: RateLimitCharge): Promise<RateLimitDecision | null> {
    try {
      return await this.store.consume(charge.key, charge.policy, { cost: -1, ...this.at() });
    } catch (error) {
      this.logger.warn(
        { err: error, group: charge.group },
        'Rate limit store unavailable; request not given back',
      );
      return null;
    }
  }

  private at(): { nowMs?: number } {
    return this.clock ? { nowMs: this.clock() } : {};
  }
}
