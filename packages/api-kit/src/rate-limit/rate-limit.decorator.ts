import { applyDecorators, HttpStatus, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

import { schemaRef } from '../openapi.js';
import { PROBLEM_CONTENT_TYPE } from '../problem-details.filter.js';
import { RateLimitRefundInterceptor } from './rate-limit-refund.interceptor.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { RATE_LIMIT_HEADERS } from './rate-limit.headers.js';
import { RATE_LIMIT_RULES, type RateLimitOptions, type RateLimitRule } from './rate-limit.rules.js';

/**
 * Limits how often each caller may use a controller or route (ADR-009 per-client rate limits).
 * The policy for `group` comes from configuration (`RateLimitModule`), not code: routes that
 * share a group and key share each caller's budget.
 *
 * Several `@RateLimit`s on one controller or route are separate budgets a request must all fit
 * in, checked top to bottom (each keyed on its own, e.g. per IP, and per IP and Commission).
 * Route-level `@RateLimit`s replace controller-level ones.
 *
 * Every response of the route carries `RateLimit-Limit`, `RateLimit-Remaining` and
 * `RateLimit-Reset` (seconds until the budget is full again) of its tightest budget. Past a
 * limit the caller gets 429 problem details with code `rate-limit-exceeded`,
 * `retryAfterSeconds` and `Retry-After`, and the handler does not run.
 *
 * If the store is down, requests pass unlimited rather than fail. Needs `RateLimitModule` in
 * the application; the app fails to start without it, or when `group` has no configured
 * policy. Code can charge the same budgets itself through `RateLimiter`.
 *
 * @example
 * @Post('batches')
 * @RateLimit('roster-api')
 * upsertBatch() {}
 *
 * @example
 * @Public()
 * @Post('sessions')
 * @RateLimit('onboarding-identify', { key: byClientIp, refundOn: ['no-roster'] })
 * @RateLimit('onboarding-identify-commission', {
 *   key: byClientIpAnd({ body: 'commission' }),
 *   refundOn: ['no-roster'],
 * })
 * identify() {}
 */
export const RateLimit = (group: string, options: RateLimitOptions = {}) =>
  applyDecorators(
    addRule({ group, ...options }),
    UseGuards(RateLimitGuard),
    ...(options.refundOn?.length ? [UseInterceptors(RateLimitRefundInterceptor)] : []),
    onFirstRule(
      ApiResponse({
        status: HttpStatus.TOO_MANY_REQUESTS,
        description:
          'Problem code `rate-limit-exceeded`: rate limit exceeded; retry after the seconds in `retryAfterSeconds` and Retry-After',
        content: { [PROBLEM_CONTENT_TYPE]: { schema: schemaRef('ProblemDetails') } },
        headers: {
          ...RATE_LIMIT_HEADERS,
          'Retry-After': {
            description: 'Seconds until the next request would be allowed',
            schema: { type: 'integer' },
          },
        },
      }),
    ),
  );

/**
 * Applies `decorator` for the first `@RateLimit` on a target only: several budgets on one route
 * share one documented 429 (otherwise the contract repeats its description per budget).
 */
function onFirstRule(
  decorator: ClassDecorator & MethodDecorator,
): ClassDecorator & MethodDecorator {
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    const holder = (descriptor?.value as object | undefined) ?? target;
    const rules = (Reflect.getOwnMetadata(RATE_LIMIT_RULES, holder) ?? []) as RateLimitRule[];
    if (rules.length > 1) return;
    if (descriptor && key !== undefined) decorator(target, key, descriptor);
    else (decorator as ClassDecorator)(target as never);
  };
}

/** Adds `rule` in front of the target's rules: decorators apply bottom-up. */
function addRule(rule: RateLimitRule): ClassDecorator & MethodDecorator {
  return (target: object, _key?: string | symbol, descriptor?: PropertyDescriptor) => {
    const holder = (descriptor?.value as object | undefined) ?? target;
    const rules = (Reflect.getOwnMetadata(RATE_LIMIT_RULES, holder) ?? []) as RateLimitRule[];
    Reflect.defineMetadata(RATE_LIMIT_RULES, [rule, ...rules], holder);
  };
}
