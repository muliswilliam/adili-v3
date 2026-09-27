import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';

import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import { ApiProblemResponse } from '../openapi.js';
import { ProblemException } from '../problem-details.filter.js';
import { type RateLimitPolicy, RateLimitStore } from './rate-limit.store.js';

export const RATE_LIMIT_GROUP = Symbol('RATE_LIMIT_GROUP');
/** Injection token of the configured policies, by route group. */
export const RATE_LIMIT_POLICIES = Symbol('RATE_LIMIT_POLICIES');

export const RATE_LIMIT_LIMIT_HEADER = 'ratelimit-limit';
export const RATE_LIMIT_REMAINING_HEADER = 'ratelimit-remaining';
export const RATE_LIMIT_RESET_HEADER = 'ratelimit-reset';

/**
 * Limits how often each caller may use a controller or route (ADR-009 per-client rate limits).
 * The policy for `group` comes from configuration (`RateLimitModule`), not code: routes that
 * share a group share each caller's budget. A route-level `@RateLimit` replaces a
 * controller-level one.
 *
 * Every response of the route carries `RateLimit-Limit`, `RateLimit-Remaining` and
 * `RateLimit-Reset` (seconds until the budget is full again). Past the limit the caller gets
 * 429 `rate-limit-exceeded` problem details with `Retry-After`, and the handler does not run.
 *
 * Callers are counted per OAuth client and subject: a machine client (client credentials, one
 * service account) has one budget; people signed in through the same app each have their own.
 * Unauthenticated calls on `@Public()` routes are counted per IP address. If the store is down,
 * requests pass unlimited rather than fail.
 *
 * Needs `RateLimitModule` in the application; the app fails to start without it, or when
 * `group` has no configured policy.
 *
 * @example
 * @Post('batches')
 * @RateLimit('roster-api')
 * upsertBatch() {}
 */
export const RateLimit = (group: string) =>
  applyDecorators(
    SetMetadata(RATE_LIMIT_GROUP, group),
    UseGuards(RateLimitGuard),
    ApiProblemResponse(
      HttpStatus.TOO_MANY_REQUESTS,
      'Rate limit exceeded; retry after the seconds in Retry-After',
    ),
  );

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  /**
   * Requests already counted. A route-level `@RateLimit` under a controller-level one registers
   * this guard twice; the request still takes a single token.
   */
  private readonly counted = new WeakSet<object>();

  constructor(
    private readonly reflector: Reflector,
    private readonly store: RateLimitStore,
    @Inject(RATE_LIMIT_POLICIES) private readonly policies: Record<string, RateLimitPolicy>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const group = this.reflector.getAllAndOverride<string | undefined>(RATE_LIMIT_GROUP, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (group === undefined) {
      return true;
    }
    const policy = this.policies[group];
    if (!policy) {
      throw new Error(`No rate limit configured for group "${group}"`);
    }
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const reply = http.getResponse<FastifyReply>();
    if (this.counted.has(request)) {
      return true;
    }
    this.counted.add(request);

    let decision;
    try {
      decision = await this.store.consume(`rate-limit:${group}:${callerKey(request)}`, policy);
    } catch (error) {
      this.logger.warn({ err: error, group }, 'Rate limit store unavailable; request not limited');
      return true;
    }

    void reply.headers({
      [RATE_LIMIT_LIMIT_HEADER]: decision.limit,
      [RATE_LIMIT_REMAINING_HEADER]: decision.remaining,
      [RATE_LIMIT_RESET_HEADER]: decision.resetSeconds,
    });
    if (!decision.allowed) {
      void reply.header('retry-after', decision.retryAfterSeconds);
      throw new ProblemException({
        type: 'rate-limit-exceeded',
        title: 'Too Many Requests',
        status: HttpStatus.TOO_MANY_REQUESTS,
        detail: `Rate limit of ${policy.limit} requests per ${policy.windowSeconds} seconds exceeded. Retry after ${decision.retryAfterSeconds} seconds.`,
      });
    }
    return true;
  }
}

function callerKey(request: AuthenticatedRequest): string {
  const { principal } = request;
  if (!principal) {
    return `ip:${request.ip}`;
  }
  return `client:${principal.clientId ?? '-'}:${principal.subject}`;
}
