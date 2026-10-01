import type { ProblemCode } from '../problem-codes.js';
import type { RateLimitKey } from './rate-limit.keys.js';

/** Metadata: the `RateLimitRule`s of a controller or route, in the order they are checked. */
export const RATE_LIMIT_RULES = Symbol('RATE_LIMIT_RULES');

export interface RateLimitOptions {
  /** Whose budget a request draws on; `byCaller` by default (see `rate-limit.keys.ts`). */
  key?: RateLimitKey;
  /**
   * Outcomes that do not count: when the route fails with a problem carrying one of these
   * codes, its request is given back (it no longer counts in the window), e.g. `['no-roster']`
   * so that choosing a Commission without a roster uses up nothing.
   */
  refundOn?: readonly ProblemCode[];
}

export interface RateLimitRule extends RateLimitOptions {
  group: string;
}
