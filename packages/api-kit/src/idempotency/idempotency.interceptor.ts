import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { catchError, from, mergeMap, type Observable, of } from 'rxjs';

import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import {
  PROBLEM_CONTENT_TYPE,
  ProblemException,
  toProblemDetails,
} from '../problem-details.filter.js';
import { type IdempotencyScope, IdempotencyStore } from './idempotency.store.js';
import { hashRequest } from './request-hash.js';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
/** Set on responses served from the store instead of the handler. */
export const IDEMPOTENT_REPLAYED_HEADER = 'idempotent-replayed';
const MAX_KEY_LENGTH = 255;

/**
 * Makes a write safe to retry (ADR-009). The request must carry an `Idempotency-Key` header.
 * The first request with a key runs the handler and its outcome is stored for 24 hours;
 * a retry with the same key and body gets the stored status and body back with
 * `Idempotent-Replayed: true`, and the handler is not invoked again.
 *
 * - Missing or malformed header: 400 `idempotency-key-missing`.
 * - Same key, different method, URL or body: 422 `idempotency-key-reused`.
 * - Same key while the first request is still running: 409 `idempotency-key-in-use`.
 * - 2xx and 4xx outcomes are stored; 5xx are not, so the client can retry.
 *
 * Keys are scoped per caller (token `sub`): two callers may use the same key independently.
 * Needs `IdempotencyModule` in the application; the app fails to start without it.
 *
 * @example
 * @Post()
 * @RequireIdempotencyKey()
 * create(@Body(new ZodValidationPipe(createCommission)) body: CreateCommission) {}
 */
export const RequireIdempotencyKey = () =>
  applyDecorators(
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description: 'Client-generated UUID, unique per logical request; reuse on retry',
      schema: { type: 'string', format: 'uuid' },
    }),
  );

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly store: IdempotencyStore) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const reply = http.getResponse<FastifyReply>();
    if (!request.principal) {
      throw new Error('@RequireIdempotencyKey() needs an authenticated route');
    }

    const scope: IdempotencyScope = {
      key: readKey(request.headers[IDEMPOTENCY_KEY_HEADER]),
      subject: request.principal.subject,
    };
    const requestHash = hashRequest(request);
    const claim = await this.store.claim(scope, requestHash);

    if (claim.outcome === 'existing') {
      if (claim.requestHash !== requestHash) {
        throw new ProblemException({
          type: 'idempotency-key-reused',
          title: 'Idempotency-Key reused',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          detail: 'This Idempotency-Key was already used for a different request.',
        });
      }
      if (!claim.response) {
        throw new ProblemException({
          type: 'idempotency-key-in-use',
          title: 'Request in progress',
          status: HttpStatus.CONFLICT,
          detail: 'A request with this Idempotency-Key is still being processed. Retry shortly.',
        });
      }
      const { status, body } = claim.response;
      void reply.status(status).header(IDEMPOTENT_REPLAYED_HEADER, 'true');
      if (status >= 400) {
        void reply.header('content-type', PROBLEM_CONTENT_TYPE);
      }
      return of(body ?? undefined);
    }

    return next.handle().pipe(
      catchError((error: unknown) => from(this.recordFailure(scope, request.url, error))),
      mergeMap(async (body: unknown) => {
        await this.store.complete(scope, { status: reply.statusCode, body: toJson(body) });
        return body;
      }),
    );
  }

  /** Stores client errors (they will not change on retry); frees the key after server errors. */
  private async recordFailure(
    scope: IdempotencyScope,
    url: string,
    error: unknown,
  ): Promise<never> {
    const problem = toProblemDetails(error, url);
    if (problem.status < 500) {
      await this.store.complete(scope, { status: problem.status, body: problem });
    } else {
      await this.store.release(scope);
    }
    throw error;
  }
}

function readKey(header: string | string[] | undefined): string {
  if (typeof header === 'string' && header.length > 0 && header.length <= MAX_KEY_LENGTH) {
    return header;
  }
  throw new ProblemException({
    type: 'idempotency-key-missing',
    title: 'Idempotency-Key required',
    status: HttpStatus.BAD_REQUEST,
    detail: `Send one Idempotency-Key header of 1 to ${MAX_KEY_LENGTH} characters, unique per logical request, and reuse it on retry.`,
  });
}

/** The body as the client receives it: class instances, dates and `undefined` normalised. */
function toJson(body: unknown): unknown {
  return body === undefined ? null : (JSON.parse(JSON.stringify(body)) as unknown);
}
