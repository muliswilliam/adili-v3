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

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: { path: string; message: string }[];
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
    const problem = this.toProblem(exception);
    problem.instance = request.url;

    if (problem.status >= 500) {
      this.logger.error(exception);
    }
    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json')
      .send(problem);
    return undefined;
  }

  private toProblem(exception: unknown): ProblemDetails {
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
}
