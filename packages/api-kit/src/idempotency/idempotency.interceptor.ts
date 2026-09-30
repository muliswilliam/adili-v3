import {
  applyDecorators,
  type CallHandler,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  type NestInterceptor,
  SetMetadata,
  UseInterceptors,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiHeader } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { catchError, from, mergeMap, type Observable, of } from 'rxjs';

import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import { ApiProblemResponse } from '../openapi.js';
import {
  PROBLEM_CONTENT_TYPE,
  ProblemException,
  toProblemDetails,
} from '../problem-details.filter.js';
import {
  type IdempotencyScope,
  IdempotencyStore,
  type StoredResponse,
} from './idempotency.store.js';
import { hashRequest } from './request-hash.js';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
/** Set on responses served from the store instead of the handler. */
export const IDEMPOTENT_REPLAYED_HEADER = 'idempotent-replayed';
const MAX_KEY_LENGTH = 255;
/** Pauses between attempts to record an outcome; one attempt more than there are pauses. */
const RECORD_RETRY_DELAYS_MS = [50, 250];
const IDEMPOTENCY_OWNER = 'adili:idempotency-owner';
const IDEMPOTENCY_OPTIONAL = 'adili:idempotency-optional';
const IDEMPOTENCY_SETTLED = 'adili:idempotency-settled';

export interface RequireIdempotencyKeyOptions {
  /**
   * Whom keys belong to on a public route, which has no token `sub`: typically the resource and a
   * digest of the secret the caller proves it holds, so a caller without the secret never reaches
   * another's stored response. Authenticated routes leave it out: keys belong to the token's `sub`.
   */
  owner?: (request: AuthenticatedRequest) => string;
  /**
   * Whether a 2xx answer is final. One that is not (a transient failure reported in the body,
   * which the caller is expected to retry) frees the key instead of being stored, so the retry
   * runs the handler again rather than getting the same failure replayed. Default: every 2xx is
   * final.
   */
  settled?: (body: never) => boolean;
}

/**
 * Makes a write safe to retry (ADR-009). The request must carry an `Idempotency-Key` header.
 * The first request with a key runs the handler and its outcome is stored for 24 hours;
 * a retry with the same key and body gets the stored status and body back with
 * `Idempotent-Replayed: true`, and the handler is not invoked again.
 *
 * - Missing or malformed header: 400 `idempotency-key-missing`.
 * - Same key, different method, URL or body: 422 `idempotency-key-reused`.
 * - Same key while the first request is still running: 409 `idempotency-key-in-use`.
 * - 2xx and 4xx outcomes are stored; 5xx are not, so the client can retry. Nor are 2xx answers
 *   that `options.settled` says are not final.
 * - Storing an outcome is retried briefly. If it still fails, the client gets the handler's
 *   outcome anyway: turning a write that happened into an error would invite the very retry
 *   that runs it twice once the unfinished claim is taken for abandoned.
 *
 * Keys are scoped per caller (token `sub`, or `options.owner` on a public route): two callers
 * may use the same key independently. Needs `IdempotencyModule` in the application; the app
 * fails to start without it.
 *
 * @example
 * @Post()
 * @RequireIdempotencyKey()
 * create(@Body(new ZodValidationPipe(createCommission)) body: CreateCommission) {}
 */
export const RequireIdempotencyKey = (options: RequireIdempotencyKeyOptions = {}) =>
  idempotencyKey(options, { optional: false });

/**
 * As `RequireIdempotencyKey`, but a request without the header runs the handler unguarded: for
 * internal command endpoints some of whose callers cannot send one yet (ADR-013 §7.5 asks every
 * command endpoint to accept a key). A request with the header gets the same storage, replay and
 * refusals, and a malformed header is still 400.
 */
export const AcceptIdempotencyKey = (options: RequireIdempotencyKeyOptions = {}) =>
  idempotencyKey(options, { optional: true });

function idempotencyKey(
  options: RequireIdempotencyKeyOptions,
  { optional }: { optional: boolean },
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(IDEMPOTENCY_OWNER, options.owner),
    SetMetadata(IDEMPOTENCY_OPTIONAL, optional),
    SetMetadata(IDEMPOTENCY_SETTLED, options.settled),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({
      name: 'Idempotency-Key',
      required: !optional,
      description: optional
        ? 'Optional. Client-generated UUID, unique per logical request; reuse on retry and the stored answer is replayed instead of acting twice'
        : 'Client-generated UUID, unique per logical request; reuse on retry',
      schema: { type: 'string', format: 'uuid' },
    }),
    ApiProblemResponse(422, 'Idempotency-Key reused with a different request body'),
  );
}

/**
 * The request's `Idempotency-Key`, for a handler that keeps it with what it writes (e.g. to
 * recognise its own retry after the stored answer was lost). Only on `@RequireIdempotencyKey()`
 * routes, which refuse a request without one, so it is always a string there. Unlike
 * `@Headers()`, it adds nothing to the contract: the decorator documents the header.
 */
export const IdempotencyKey = createParamDecorator(
  (_: unknown, context: ExecutionContext): string => {
    const header = context.switchToHttp().getRequest<AuthenticatedRequest>().headers[
      IDEMPOTENCY_KEY_HEADER
    ];
    return readKey(header);
  },
);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly store: IdempotencyStore,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const reply = http.getResponse<FastifyReply>();
    if (
      request.headers[IDEMPOTENCY_KEY_HEADER] === undefined &&
      this.reflector.get<boolean>(IDEMPOTENCY_OPTIONAL, context.getHandler())
    ) {
      return next.handle();
    }
    const owner = this.reflector.get<RequireIdempotencyKeyOptions['owner']>(
      IDEMPOTENCY_OWNER,
      context.getHandler(),
    );
    const subject = owner ? owner(request) : request.principal?.subject;
    if (subject === undefined) {
      throw new Error('@RequireIdempotencyKey() needs an authenticated route or an owner');
    }

    const scope: IdempotencyScope = {
      key: readKey(request.headers[IDEMPOTENCY_KEY_HEADER]),
      subject,
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

    const { token } = claim;
    const settled = this.reflector.get<((body: unknown) => boolean) | undefined>(
      IDEMPOTENCY_SETTLED,
      context.getHandler(),
    );
    return next.handle().pipe(
      catchError((error: unknown) => from(this.recordFailure(scope, token, request.url, error))),
      mergeMap(async (body: unknown) => {
        if (settled && !settled(body)) {
          await this.record(scope, 'release', () => this.store.release(scope, token));
        } else {
          await this.record(scope, 'complete', () =>
            this.complete(scope, token, { status: reply.statusCode, body: toJson(body) }),
          );
        }
        return body;
      }),
    );
  }

  /** Stores client errors (they will not change on retry); frees the key after server errors. */
  private async recordFailure(
    scope: IdempotencyScope,
    token: string,
    url: string,
    error: unknown,
  ): Promise<never> {
    const problem = toProblemDetails(error, url);
    if (problem.status < 500) {
      await this.record(scope, 'complete', () =>
        this.complete(scope, token, { status: problem.status, body: problem }),
      );
    } else {
      // Left unreleased, the claim still frees itself once it counts as abandoned.
      await this.record(scope, 'release', () => this.store.release(scope, token));
    }
    throw error;
  }

  /** Stores the outcome, or says why it could not: the claim was taken over meanwhile. */
  private async complete(
    scope: IdempotencyScope,
    token: string,
    response: StoredResponse,
  ): Promise<void> {
    if (!(await this.store.complete(scope, token, response))) {
      this.logger.warn(
        { idempotencyKey: scope.key, subject: scope.subject },
        'An idempotent request outlived its claim, which a retry took over; its outcome is not stored',
      );
    }
  }

  /**
   * Runs a store write with brief retries. Never throws: the request's own outcome matters more
   * to the client than its record, so a store that stays down is logged and the outcome sent.
   */
  private async record(
    scope: IdempotencyScope,
    operation: 'complete' | 'release',
    write: () => Promise<void>,
  ): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await write();
        return;
      } catch (error) {
        const delay = RECORD_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          this.logger.error(
            { err: error, idempotencyKey: scope.key, subject: scope.subject, operation },
            'Could not record the outcome of an idempotent request; a retry after the claim timeout runs it again',
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
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
