import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { catchError, from, mergeMap, type Observable, throwError } from 'rxjs';

import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import { ProblemException } from '../problem-details.filter.js';
import { takeRefundableCharges } from './rate-limit.guard.js';
import { setRateLimitHeaders, tightest } from './rate-limit.headers.js';
import type { RateLimitDecision } from './rate-limit.store.js';
import { RateLimiter } from './rate-limiter.js';

/**
 * Gives a request back to its budgets when the route fails with a problem code its `@RateLimit`
 * lists in `refundOn`, and updates the headers to match. Registered by `@RateLimit`.
 */
@Injectable()
export class RateLimitRefundInterceptor implements NestInterceptor {
  constructor(private readonly limiter: RateLimiter) {}

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
    const taken = takeRefundableCharges(http.getRequest<AuthenticatedRequest>());
    if (!taken?.some((charge) => ProblemException.hasCode(error, charge.refundOn))) return;

    const decisions: RateLimitDecision[] = [];
    for (const charge of taken) {
      const refunded = ProblemException.hasCode(error, charge.refundOn)
        ? await this.limiter.refund(charge)
        : null;
      decisions.push(refunded ?? charge.decision);
    }
    const shown = tightest(decisions);
    if (shown) setRateLimitHeaders(http.getResponse<FastifyReply>(), shown);
  }
}
