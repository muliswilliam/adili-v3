import { HttpStatus } from '@nestjs/common';
import { type ProblemCode, ProblemException } from '@adili/api-kit';

/**
 * The access service's problem responses (RFC 9457), built one way. A problem the portal or the
 * console acts on carries a registered `code` (`PROBLEM_CODES` in api-kit, mapped to copy by the
 * front ends); `errors` name the fields at fault.
 */

/** A field at fault, by its dotted path in the request (e.g. `partIII.reason`). */
export interface ProblemError {
  path: string;
  message: string;
}

/**
 * A problem registered in `PROBLEM_CODES`: its status and title, with `detail` for developers
 * and, when given, the fields at fault.
 */
export function problem(
  code: ProblemCode,
  detail: string,
  errors?: readonly ProblemError[],
): ProblemException {
  return ProblemException.fromCode(code, {
    detail,
    ...(errors ? { extensions: { errors: [...errors] } } : {}),
  });
}

/** 400: the request cannot be taken as it is; `errors` say which fields. */
export function badRequest(detail: string, errors?: readonly ProblemError[]): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Bad Request',
    status: HttpStatus.BAD_REQUEST,
    detail,
    ...(errors ? { errors: [...errors] } : {}),
  });
}

/** 403: the caller may not do this. */
export function forbidden(detail: string): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Forbidden',
    status: HttpStatus.FORBIDDEN,
    detail,
  });
}

/** 409: the request is not in a state that allows this (for states no registered code names). */
export function conflict(detail: string): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Conflict',
    status: HttpStatus.CONFLICT,
    detail,
  });
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

/** 503 `directory-unavailable`: the Commission directory cannot be reached; nothing was done. */
export function directoryUnavailable(): ProblemException {
  return new ProblemException({
    type: 'directory-unavailable',
    title: 'Upstream service unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: 'The Commission directory cannot be reached. Try again shortly.',
  });
}

/** 503 `documents-unavailable`: uploads cannot be checked or linked; nothing was saved. */
export function documentsUnavailable(): ProblemException {
  return new ProblemException({
    type: 'documents-unavailable',
    title: 'Upstream service unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: 'The attachments cannot be checked right now. Try again shortly.',
  });
}

/** 503 `key-service-unavailable`: the Commission's key cannot be used; nothing was stored. */
export function keyServiceUnavailable(): ProblemException {
  return new ProblemException({
    type: 'key-service-unavailable',
    title: 'Upstream service unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: 'The request cannot be protected right now. Try again shortly.',
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
