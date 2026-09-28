import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ACTING_TENANT_HEADER,
  type AuditedReadOptions,
  type AuthenticatedRequest,
  auditedReadOf,
} from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { mergeMap, type Observable } from 'rxjs';

import { EventPublisher } from './event-publisher.js';
import type { NewEvent } from './envelope.js';

/** A read of sensitive data, for the audit trail (ADR-008 Pipeline step 2). */
export const AUDIT_READ = 'audit.read.v1';

export interface AuditReadData extends Record<string, unknown> {
  /** The route's audit action, e.g. `roster.record.viewed`. */
  action: AuditedReadOptions['action'];
  resource: {
    type: AuditedReadOptions['resource'];
    /** The route's path parameters (ids and slugs; never the query, which may hold searches). */
    params: Record<string, string>;
  };
  actor: {
    /** Token `sub`: a user, or a service account. */
    subject: string;
    /** OAuth client that obtained the token; null when it has none. */
    clientId: string | null;
    tenant: string | null;
    roles: readonly string[];
  };
  outcome: 'success';
  request: {
    method: string;
    /** The route template, e.g. `/v1/commissions/:slug/roster/records/:recordId`. */
    route: string;
  };
}

type AuditedRequest = AuthenticatedRequest & { params?: Record<string, string> };

/**
 * Records an `audit.read.v1` event in the outbox for each successful response of a route marked
 * `@AuditedRead` (api-kit), before the response is sent: a read the audit trail cannot record
 * fails instead of going unrecorded. The event carries the action, the resource's path
 * parameters, the actor from the verified token and the route, no response data; its `tenant`
 * is the tenant whose data was read (the route's `slug`, else the tenant a service acts for,
 * else the caller's). Registered for every route by `EventsModule`; routes without the mark
 * pass through untouched. Refused requests never reach it (guards run first); they are the
 * audit service's to record from denials.
 */
@Injectable()
export class AuditedReadInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly events: EventPublisher,
    @InjectDatabase() private readonly db: Database,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const mark =
      context.getType() === 'http'
        ? auditedReadOf(this.reflector, context.getHandler())
        : undefined;
    if (!mark) return next.handle();
    const request = context.switchToHttp().getRequest<AuditedRequest>();
    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        await this.events.record(this.db, auditRead(mark, request));
        return body;
      }),
    );
  }
}

function auditRead(mark: AuditedReadOptions, request: AuditedRequest): NewEvent<AuditReadData> {
  const principal = request.principal;
  const params = request.params ?? {};
  const actingTenant = request.headers[ACTING_TENANT_HEADER];
  const tenant =
    params.slug ??
    (typeof actingTenant === 'string' ? actingTenant : undefined) ??
    principal?.tenant ??
    undefined;
  return {
    type: AUDIT_READ,
    tenant,
    data: {
      action: mark.action,
      resource: { type: mark.resource, params: { ...params } },
      actor: {
        subject: principal?.subject ?? 'anonymous',
        clientId: principal?.clientId ?? null,
        tenant: principal?.tenant ?? null,
        roles: principal?.roles ?? [],
      },
      outcome: 'success',
      request: { method: request.method, route: request.routeOptions.url ?? request.url },
    },
  };
}
