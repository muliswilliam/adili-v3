import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';

/**
 * The reporting service's problem responses (RFC 9457), built one way. A problem the console
 * acts on carries a `code` extension; `errors` name the fields at fault.
 */

/** A field at fault, by its path in the request. */
export interface ProblemError {
  path: string;
  message: string;
}

/** 400: the request cannot be taken as it is. */
export function badRequest(
  detail: string,
  options: { code?: string; errors?: readonly ProblemError[] } = {},
): ProblemException {
  const { code, errors } = options;
  return new ProblemException(
    {
      type: 'about:blank',
      title: 'Bad Request',
      status: HttpStatus.BAD_REQUEST,
      detail,
      ...(errors ? { errors: [...errors] } : {}),
    },
    code === undefined ? {} : { code },
  );
}

/** 403: the caller may not do this. */
export function forbidden(detail: string, code?: string): ProblemException {
  return new ProblemException(
    { type: 'about:blank', title: 'Forbidden', status: HttpStatus.FORBIDDEN, detail },
    code === undefined ? {} : { code },
  );
}

/** 404: the same whether the resource is missing or not the caller's to see. */
export function notFound(
  detail = 'The resource does not exist or is not visible to you.',
): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Not Found',
    status: HttpStatus.NOT_FOUND,
    detail,
  });
}

/** 409 `code`: the resource's state refuses the change. */
export function conflict(code: string, detail: string): ProblemException {
  return new ProblemException(
    { type: 'about:blank', title: 'Conflict', status: HttpStatus.CONFLICT, detail },
    { code },
  );
}

/** 502 `code`: an upstream system refused or failed the work; `extensions` say how. */
export function badGateway(
  code: string,
  detail: string,
  extensions: Record<string, unknown> = {},
): ProblemException {
  return new ProblemException(
    { type: 'about:blank', title: 'Bad Gateway', status: HttpStatus.BAD_GATEWAY, detail },
    { code, ...extensions },
  );
}

/** 503 `directory-unavailable`: the Commission directory cannot be reached. */
export function directoryUnavailable(): ProblemException {
  return new ProblemException({
    type: 'directory-unavailable',
    title: 'Upstream service unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: 'The Commission directory cannot be reached. Try again shortly.',
  });
}

/** 503 `workflow-unavailable`: Temporal cannot be reached, so nothing was done. */
export function workflowUnavailable(detail: string): ProblemException {
  return new ProblemException({
    type: 'workflow-unavailable',
    title: 'Upstream service unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail,
  });
}
