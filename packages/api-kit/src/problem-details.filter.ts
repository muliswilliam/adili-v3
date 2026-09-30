import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type Observable, throwError } from 'rxjs';
import { ZodError } from 'zod';

import { PROBLEM_CODES, type ProblemCode } from './problem-codes.js';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  /** Machine-readable cause from `PROBLEM_CODES`, when the throwing site supplies one. */
  code?: ProblemCode;
  detail?: string;
  instance?: string;
  errors?: { path: string; message: string }[];
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * Extension members of a problem type (RFC 9457 §3.2), rendered next to the standard members,
 * e.g. the id of the import that blocks another. Document them in the contract with a schema
 * extending `ProblemDetails`. They cannot override a standard member.
 */
export type ProblemExtensions = Record<string, unknown>;

export interface CodedProblemOptions {
  /** For developers and logs; clients show copy for the code instead. */
  detail?: string;
  /** Extension members, e.g. `attemptsLeft` for `otp-invalid`. */
  extensions?: ProblemExtensions;
}

/**
 * An HTTP error with a specific problem type, e.g. `idempotency-key-reused`.
 * Rendered as-is by ProblemDetailsFilter; `instance` is filled in from the request.
 */
export class ProblemException extends HttpException {
  constructor(
    readonly problem: Omit<ProblemDetails, 'instance'>,
    readonly extensions: ProblemExtensions = {},
  ) {
    super(problem, problem.status);
  }

  /**
   * The problem registered for `code` in `PROBLEM_CODES`: its status and title, with the code
   * as both `type` and `code`.
   *
   * @example
   * throw ProblemException.fromCode('otp-invalid', { extensions: { attemptsLeft: 2 } });
   */
  static fromCode(code: ProblemCode, options: CodedProblemOptions = {}): ProblemException {
    const { status, title } = PROBLEM_CODES[code];
    return new ProblemException(
      {
        type: code,
        title,
        status,
        code,
        ...(options.detail === undefined ? {} : { detail: options.detail }),
      },
      options.extensions,
    );
  }

  /** Whether `error` is a problem with one of `codes`. */
  static hasCode(error: unknown, codes: readonly ProblemCode[]): error is ProblemException {
    const code = error instanceof ProblemException ? error.problem.code : undefined;
    return code !== undefined && codes.includes(code);
  }
}

/** Maps any thrown value to the RFC 9457 problem the client receives. */
export function toProblemDetails(
  exception: unknown,
  instance: string,
): ProblemDetails & ProblemExtensions {
  const extensions = exception instanceof ProblemException ? exception.extensions : {};
  return { ...extensions, ...toProblem(exception), instance };
}

/** Renders every HTTP error as RFC 9457 problem details. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): Observable<never> | undefined {
    // Message handlers (RabbitMQ) keep Nest's RPC error handling.
    if (host.getType() !== 'http') {
      return throwError(() => exception);
    }
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const problem = toProblemDetails(exception, request.url);

    if (problem.status >= 500) {
      this.logger.error(exception);
    }
    void reply.status(problem.status).header('content-type', PROBLEM_CONTENT_TYPE).send(problem);
    return undefined;
  }
}

function toProblem(exception: unknown): ProblemDetails {
  if (exception instanceof ProblemException) {
    return { ...exception.problem };
  }
  if (exception instanceof ZodError) {
    return {
      type: 'about:blank',
      title: 'Validation failed',
      status: HttpStatus.BAD_REQUEST,
      errors: exception.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const detail =
      typeof response === 'string'
        ? response
        : typeof response === 'object' && 'message' in response
          ? String(response.message)
          : undefined;
    return { type: 'about:blank', title: exception.name, status, detail };
  }
  return {
    type: 'about:blank',
    title: 'Internal Server Error',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  };
}
