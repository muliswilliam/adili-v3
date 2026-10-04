import { HttpStatus } from '@nestjs/common';
import { type ProblemCode, ProblemException } from '@adili/api-kit';

/**
 * The reporting service's problem responses (RFC 9457), built one way. A problem the console
 * acts on carries a registered `code` (`PROBLEM_CODES` in api-kit, mapped to copy by the console),
 * thrown through `problem`, so its status and title are the registry's and the contract's
 * `ProblemDetails.code` lists it; `errors` name the fields at fault.
 */

/** A field at fault, by its path in the request. */
export interface ProblemError {
  path: string;
  message: string;
}

/**
 * A problem registered in `PROBLEM_CODES`: its status and title, with the code as `type` and
 * `code`, `detail` for developers and, when given, the fields at fault and other extension members.
 */
export function problem(
  code: ProblemCode,
  detail: string,
  options: { errors?: readonly ProblemError[]; extensions?: Record<string, unknown> } = {},
): ProblemException {
  const { errors, extensions } = options;
  return ProblemException.fromCode(code, {
    detail,
    extensions: { ...extensions, ...(errors ? { errors: [...errors] } : {}) },
  });
}

/** 400: the request cannot be taken as it is (for causes no registered code names). */
export function badRequest(detail: string): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Bad Request',
    status: HttpStatus.BAD_REQUEST,
    detail,
  });
}

/** 403: the caller may not do this (for causes no registered code names). */
export function forbidden(detail: string): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Forbidden',
    status: HttpStatus.FORBIDDEN,
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

/** 503 `directory-unavailable`: the Commission directory cannot be reached. */
export function directoryUnavailable(): ProblemException {
  return new ProblemException({
    type: 'directory-unavailable',
    title: 'Upstream service unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: 'The Commission directory cannot be reached. Try again shortly.',
  });
}

/** 503 `storage-unavailable`: object storage (the open-data bucket) cannot be reached. */
export function storageUnavailable(): ProblemException {
  return new ProblemException({
    type: 'storage-unavailable',
    title: 'Upstream service unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: 'The release files could not be reached just now. Try again shortly.',
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

/** 503 `ai-gateway-unavailable`: the ai-gateway cannot be reached, so nothing was asked of it. */
export function aiGatewayUnavailable(): ProblemException {
  return new ProblemException({
    type: 'ai-gateway-unavailable',
    title: 'Upstream service unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: 'The AI gateway cannot be reached. Try again shortly.',
  });
}
