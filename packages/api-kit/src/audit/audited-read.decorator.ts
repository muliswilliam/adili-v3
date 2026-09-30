import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ApiExtension } from '@nestjs/swagger';

const AUDITED_READ = Symbol('AUDITED_READ');
const AUDITED_TENANT = Symbol('AUDITED_TENANT');

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
 * see which reads leave a trace.
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

/** Names the tenant whose data an audited read returned (see `AuditedTenant`). */
export type SetAuditedTenant = (tenant: string) => void;

interface AuditableRequest {
  [AUDITED_TENANT]?: string;
}

/**
 * Injects a setter for the tenant whose data an audited read returned, for a route whose path
 * does not name it (a read by id across tenants, e.g. EACC reading a Commission's report). The
 * handler calls it once it knows the record's tenant; the audit interceptor records that tenant
 * in place of the route's `slug` or the caller's.
 *
 * @example
 * get(@Param('id') id: string, @AuditedTenant() audit: SetAuditedTenant) {
 *   const record = find(id);
 *   audit(record.tenant);
 * }
 */
export const AuditedTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SetAuditedTenant => {
    const request = context.switchToHttp().getRequest<AuditableRequest>();
    return (tenant) => {
      request[AUDITED_TENANT] = tenant;
    };
  },
);

/** The tenant a handler named through `AuditedTenant`; undefined when it named none. */
export function auditedTenantOf(request: object): string | undefined {
  return (request as AuditableRequest)[AUDITED_TENANT];
}
