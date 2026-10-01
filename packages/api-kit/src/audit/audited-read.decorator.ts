import { applyDecorators, SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ApiExtension } from '@nestjs/swagger';

const AUDITED_READ = Symbol('AUDITED_READ');

export interface AuditedReadOptions {
  /** Audit action of the read, e.g. `roster.record.viewed` (ADR-008 event schema). */
  action: string;
  /** Audit resource type, e.g. `roster-record`. */
  resource: string;
}

/**
 * Marks a route whose successful responses are reads of sensitive data, which ADR-008 audits
 * (Pipeline step 2: an interceptor writes `audit.read.v1` to the service's outbox before the
 * response is sent). The interceptor (`AuditedReadInterceptor` in `@adili/events`) reads the
 * mark with `auditedReadOf`; the OpenAPI operation carries it as `x-audited-read`, so clients
 * see which reads leave a trace. A handler that loads the resource by id says whose it is, or
 * that the caller read their own record, through `@CurrentReadAudit()` (`ReadAudit`).
 *
 * @example
 * @Get(':recordId')
 * @AuditedRead({ action: 'roster.record.viewed', resource: 'roster-record' })
 * get() {}
 */
export const AuditedRead = (options: AuditedReadOptions) =>
  applyDecorators(
    SetMetadata(AUDITED_READ, options),
    ApiExtension('x-audited-read', { ...options }),
  );

/** The audited-read mark of a route handler, or undefined when its reads are not audited. */
export function auditedReadOf(
  reflector: Reflector,
  handler: object,
): AuditedReadOptions | undefined {
  return reflector.get<AuditedReadOptions | undefined>(AUDITED_READ, handler as () => void);
}
