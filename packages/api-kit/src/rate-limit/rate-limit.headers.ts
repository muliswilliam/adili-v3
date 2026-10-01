import type { HeadersObject } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import type { RateLimitDecision } from './rate-limit.store.js';

export const RATE_LIMIT_LIMIT_HEADER = 'ratelimit-limit';
export const RATE_LIMIT_REMAINING_HEADER = 'ratelimit-remaining';
export const RATE_LIMIT_RESET_HEADER = 'ratelimit-reset';

/**
 * The headers every response of a `@RateLimit` route carries, for its documented responses:
 * `@ApiOkResponse({ ..., headers: RATE_LIMIT_HEADERS })`. The 429 documents them itself.
 */
export const RATE_LIMIT_HEADERS: HeadersObject = {
  'RateLimit-Limit': {
    description: "Requests the caller's budget holds when full",
    schema: { type: 'integer' },
  },
  'RateLimit-Remaining': {
    description: 'Requests left in the budget after this one',
    schema: { type: 'integer' },
  },
  'RateLimit-Reset': {
    description: 'Seconds until the budget is full again',
    schema: { type: 'integer' },
  },
};

/** The budget closest to running out: fewest requests left, then longest until full again. */
export function tightest(decisions: RateLimitDecision[]): RateLimitDecision | undefined {
  return decisions.reduce<RateLimitDecision | undefined>(
    (tightestSoFar, decision) =>
      !tightestSoFar ||
      decision.remaining < tightestSoFar.remaining ||
      (decision.remaining === tightestSoFar.remaining &&
        decision.resetSeconds > tightestSoFar.resetSeconds)
        ? decision
        : tightestSoFar,
    undefined,
  );
}

export function setRateLimitHeaders(reply: FastifyReply, decision: RateLimitDecision): void {
  void reply.headers({
    [RATE_LIMIT_LIMIT_HEADER]: decision.limit,
    [RATE_LIMIT_REMAINING_HEADER]: decision.remaining,
    [RATE_LIMIT_RESET_HEADER]: decision.resetSeconds,
  });
}
