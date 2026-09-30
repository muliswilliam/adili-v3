import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';

import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import type { ProblemCode } from '../problem-codes.js';
import { ProblemException } from '../problem-details.filter.js';
import { setRateLimitHeaders, tightest } from './rate-limit.headers.js';
import { byCaller } from './rate-limit.keys.js';
import { RATE_LIMIT_RULES, type RateLimitRule } from './rate-limit.rules.js';
import { type RateLimitCharge, RateLimiter } from './rate-limiter.js';

/** A request counted against one budget, and the problem codes that would give it back. */
export interface RefundableCharge extends RateLimitCharge {
  refundOn: readonly ProblemCode[];
}

/** Counted requests that may be given back (see `RateLimitRefundInterceptor`). */
const refundable = new WeakMap<object, RefundableCharge[]>();

/**
 * The request's charges that may be given back, once: a second call (a second registration of
 * the refund interceptor) gets none.
 */
export function takeRefundableCharges(request: object): RefundableCharge[] | undefined {
  const charges = refundable.get(request);
  refundable.delete(request);
  return charges;
}

/** Counts each request of a `@RateLimit` route against its budgets (`rate-limit.decorator.ts`). */
@Injectable()
export class RateLimitGuard implements CanActivate {
  /**
   * Requests already counted. A route-level `@RateLimit` under a controller-level one, or
   * several on one route, register this guard more than once; the request is counted once.
   */
  private readonly counted = new WeakSet<object>();

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMIT_RULES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rules?.length) {
      return true;
    }
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const reply = http.getResponse<FastifyReply>();
    if (this.counted.has(request)) {
      return true;
    }
    this.counted.add(request);

    const taken: RefundableCharge[] = [];
    for (const rule of rules) {
      const caller = (rule.key ?? byCaller)(request);
      if (caller === undefined) continue;
      const charge = await this.limiter.consume(rule.group, caller);
      if (!charge) continue;
      const { decision, policy } = charge;
      if (!decision.allowed) {
        setRateLimitHeaders(reply, decision);
        void reply.header('retry-after', decision.retryAfterSeconds);
        throw ProblemException.fromCode('rate-limit-exceeded', {
          detail: `Rate limit of ${policy.limit} requests per ${policy.windowSeconds} seconds exceeded. Retry after ${decision.retryAfterSeconds} seconds.`,
          extensions: { retryAfterSeconds: decision.retryAfterSeconds },
        });
      }
      taken.push({ ...charge, refundOn: rule.refundOn ?? [] });
    }

    const shown = tightest(taken.map((charge) => charge.decision));
    if (shown) setRateLimitHeaders(reply, shown);
    if (taken.some((charge) => charge.refundOn.length > 0)) refundable.set(request, taken);
    return true;
  }
}
