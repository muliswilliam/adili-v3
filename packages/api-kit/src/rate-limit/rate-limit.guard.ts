import {
  applyDecorators,
  type CallHandler,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiResponse, type HeadersObject } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { catchError, from, mergeMap, type Observable, throwError } from 'rxjs';

import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import { schemaRef } from '../openapi.js';
import type { ProblemCode } from '../problem-codes.js';
import { PROBLEM_CONTENT_TYPE, ProblemException } from '../problem-details.filter.js';
import { byCaller, type RateLimitKey } from './rate-limit.keys.js';
import {
  type ConsumeOptions,
  RATE_LIMIT_CLOCK,
  type RateLimitClock,
  type RateLimitDecision,
  type RateLimitPolicy,
  RateLimitStore,
} from './rate-limit.store.js';

/** Metadata: the `RateLimitRule`s of a controller or route, in the order they are checked. */
export const RATE_LIMIT_RULES = Symbol('RATE_LIMIT_RULES');
/** Injection token of the configured policies, by route group. */
export const RATE_LIMIT_POLICIES = Symbol('RATE_LIMIT_POLICIES');

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

export interface RateLimitOptions {
  /** Whose budget a request draws on; `byCaller` by default (see `rate-limit.keys.ts`). */
  key?: RateLimitKey;
  /**
   * Outcomes that do not count: when the route fails with a problem carrying one of these
   * codes, its token goes back to the bucket, e.g. `['no-roster']` so that choosing a
   * Commission without a roster uses up nothing.
   */
  refundOn?: readonly ProblemCode[];
}

export interface RateLimitRule extends RateLimitOptions {
  group: string;
}

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
 * policy.
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

/** A token a request took, and what would give it back. */
interface TakenToken {
  key: string;
  policy: RateLimitPolicy;
  decision: RateLimitDecision;
  refundOn: readonly ProblemCode[];
}

/** Tokens taken per request that may be refunded (see `RateLimitRefundInterceptor`). */
const refundable = new WeakMap<object, TakenToken[]>();

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  /**
   * Requests already counted. A route-level `@RateLimit` under a controller-level one, or
   * several on one route, register this guard more than once; the request is counted once.
   */
  private readonly counted = new WeakSet<object>();

  constructor(
    private readonly reflector: Reflector,
    private readonly store: RateLimitStore,
    @Inject(RATE_LIMIT_POLICIES) private readonly policies: Record<string, RateLimitPolicy>,
    @Inject(RATE_LIMIT_CLOCK) private readonly clock: RateLimitClock | null,
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

    const taken: TakenToken[] = [];
    for (const rule of rules) {
      const policy = this.policies[rule.group];
      if (!policy) {
        throw new Error(`No rate limit configured for group "${rule.group}"`);
      }
      const caller = (rule.key ?? byCaller)(request);
      if (caller === undefined) continue;
      const key = `rate-limit:${rule.group}:${caller}`;

      let decision;
      try {
        decision = await this.store.consume(key, policy, at(this.clock));
      } catch (error) {
        this.logger.warn(
          { err: error, group: rule.group },
          'Rate limit store unavailable; request not limited',
        );
        continue;
      }
      if (!decision.allowed) {
        setRateLimitHeaders(reply, decision);
        void reply.header('retry-after', decision.retryAfterSeconds);
        throw ProblemException.fromCode('rate-limit-exceeded', {
          detail: `Rate limit of ${policy.limit} requests per ${policy.windowSeconds} seconds exceeded. Retry after ${decision.retryAfterSeconds} seconds.`,
          extensions: { retryAfterSeconds: decision.retryAfterSeconds },
        });
      }
      taken.push({ key, policy, decision, refundOn: rule.refundOn ?? [] });
    }

    const shown = tightest(taken.map((token) => token.decision));
    if (shown) setRateLimitHeaders(reply, shown);
    if (taken.some((token) => token.refundOn.length > 0)) refundable.set(request, taken);
    return true;
  }
}

/**
 * Gives a request's tokens back when the route fails with a problem code its `@RateLimit`
 * lists in `refundOn`, and updates the headers to match. Registered by `@RateLimit`.
 */
@Injectable()
export class RateLimitRefundInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimitRefundInterceptor.name);

  constructor(
    private readonly store: RateLimitStore,
    @Inject(RATE_LIMIT_CLOCK) private readonly clock: RateLimitClock | null,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          from(this.refund(context, error)).pipe(mergeMap(() => throwError(() => error))),
        ),
      );
  }

  private async refund(context: ExecutionContext, error: unknown): Promise<void> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const taken = refundable.get(request);
    // Taken once, so a second registration of this interceptor refunds nothing more.
    refundable.delete(request);
    if (!taken?.some((token) => ProblemException.hasCode(error, token.refundOn))) return;

    const decisions: RateLimitDecision[] = [];
    for (const token of taken) {
      if (!ProblemException.hasCode(error, token.refundOn)) {
        decisions.push(token.decision);
        continue;
      }
      try {
        decisions.push(
          await this.store.consume(token.key, token.policy, { cost: -1, ...at(this.clock) }),
        );
      } catch (refundError) {
        this.logger.warn({ err: refundError }, 'Rate limit store unavailable; token not refunded');
        decisions.push(token.decision);
      }
    }
    const shown = tightest(decisions);
    if (shown) setRateLimitHeaders(http.getResponse<FastifyReply>(), shown);
  }
}

function at(clock: RateLimitClock | null): ConsumeOptions {
  return clock ? { nowMs: clock() } : {};
}

/** The budget closest to running out: fewest requests left, then longest to refill. */
function tightest(decisions: RateLimitDecision[]): RateLimitDecision | undefined {
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

function setRateLimitHeaders(reply: FastifyReply, decision: RateLimitDecision): void {
  void reply.headers({
    [RATE_LIMIT_LIMIT_HEADER]: decision.limit,
    [RATE_LIMIT_REMAINING_HEADER]: decision.remaining,
    [RATE_LIMIT_RESET_HEADER]: decision.resetSeconds,
  });
}
