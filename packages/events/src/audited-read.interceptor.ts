import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  type AuditedReadOptions,
  type AuditedResource,
  type AuthenticatedRequest,
  auditedReadOf,
  readAuditOf,
} from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { mergeMap, type Observable } from 'rxjs';

import { EventPublisher } from './event-publisher.js';
import type { NewEvent } from './envelope.js';

/** A read of sensitive data, for the audit trail (ADR-008 Pipeline step 2). */
export const AUDIT_READ = 'audit.read.v1';

/**
 * The header in which a calling service names the officer it reads for (`X-Acting-Subject` on
 * internal reads), recorded as the actor's `onBehalfOf` (ADR-008 `actor.on-behalf-of`).
 */
export const ACTING_SUBJECT_HEADER = 'x-acting-subject';

export interface AuditReadData extends Record<string, unknown> {
  /** The route's audit action, e.g. `roster.record.viewed`. */
  action: AuditedReadOptions['action'];
  resource: {
    type: AuditedReadOptions['resource'];
    /** The route's path parameters (ids and slugs; never the query, which may hold searches). */
    params: Record<string, string>;
    /** The tenant whose data was read (the event's `tenant`); null when none is known. */
    tenant: string | null;
    /** The person the data is about, when the handler named one; null otherwise. */
    subjectPersonId: string | null;
  };
  actor: {
    /** Token `sub`: a user, or a service account. */
    subject: string;
    /** OAuth client that obtained the token; null when it has none. */
    clientId: string | null;
    tenant: string | null;
    roles: readonly string[];
    /** The subject the caller says it acts for (`X-Acting-Subject`); absent when it names none. */
    onBehalfOf?: string;
  };
  outcome: 'success';
  request: {
    method: string;
    /** The route template, e.g. `/v1/commissions/:slug/roster/records/:recordId`. */
    route: string;
  };
}

/**
 * `actingTenant` is set by api-kit's `InternalApi()` guard once it admitted a service token with
 * the route's internal scope and a valid `X-Acting-Tenant` (ADR-013 §8.1).
 */
type AuditedRequest = AuthenticatedRequest & {
  params?: Record<string, string>;
  actingTenant?: string;
};

/**
 * Records an `audit.read.v1` event in the outbox for each successful response of a route marked
 * `@AuditedRead` (api-kit), before the response is sent: a read the audit trail cannot record
 * fails instead of going unrecorded. The event carries the action, the resource's path
 * parameters, the actor from the verified token and the route, no response data; its `tenant`
 * is the tenant whose data was read: the one the handler named with `ReadAudit.resource` (with
 * the person the data is about), else the route's `slug`, else the tenant a service acts for,
 * else the caller's. A read the handler marked `ReadAudit.ownRecord` (the caller's own record)
 * is not recorded. The acting headers (`X-Acting-Tenant`, and `X-Acting-Subject` as the actor's
 * `onBehalfOf`) count only when api-kit's `InternalApi()` guard admitted the call, which takes
 * service tokens with the route's internal scope alone (ADR-013 §8.1); anywhere else a caller
 * could name whomever it liked. Registered for every route by
 * `EventsModule`; routes without the mark pass through untouched. Refused requests never reach
 * it (guards run first); they are the
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
        const audit = readAuditOf(request);
        if (!audit.isOwnRecord) {
          await this.events.record(this.db, auditRead(mark, request, audit.describedResource));
        }
        return body;
      }),
    );
  }
}

function auditRead(
  mark: AuditedReadOptions,
  request: AuditedRequest,
  resource: AuditedResource | undefined,
): NewEvent<AuditReadData> {
  const principal = request.principal;
  const params = request.params ?? {};
  const route = request.routeOptions.url ?? request.url;
  // The acting headers count only once InternalApi() admitted the call: a service token with the
  // route's internal scope. Anywhere else a caller could name whomever it liked.
  const actingTenant = request.actingTenant;
  const actingSubject =
    actingTenant === undefined ? undefined : request.headers[ACTING_SUBJECT_HEADER];
  const tenant = resource?.tenant ?? params.slug ?? actingTenant ?? principal?.tenant ?? undefined;
  return {
    type: AUDIT_READ,
    tenant,
    data: {
      action: mark.action,
      resource: {
        type: mark.resource,
        params: { ...params },
        tenant: tenant ?? null,
        subjectPersonId: resource?.subjectPersonId ?? null,
      },
      actor: {
        subject: principal?.subject ?? 'anonymous',
        clientId: principal?.clientId ?? null,
        tenant: principal?.tenant ?? null,
        roles: principal?.roles ?? [],
        ...(typeof actingSubject === 'string' && actingSubject !== ''
          ? { onBehalfOf: actingSubject }
          : {}),
      },
      outcome: 'success',
      request: { method: request.method, route },
    },
  };
}
