import {
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  type CanActivate,
  Injectable,
  applyDecorators,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import {
  ACTING_TENANT_HEADER,
  ApiProblemResponse,
  type AuthenticatedRequest,
  notFoundIfInvisible,
  type Principal,
  ProblemException,
} from '@adili/api-kit';
import { z } from 'zod';

import { reviewTenant, TENANT_SLUG } from '../cases/access.js';

/** The Commission whose clarifications a staff caller works; anyone else gets 404. */
export function staffTenant(principal: Principal): string {
  return notFoundIfInvisible(reviewTenant(principal));
}

/** Only the case's assignee composes and issues its clarifications (spec 07a authorisation). */
export function requireAssignee(principal: Principal, assignee: string | null): void {
  if (assignee !== principal.subject) {
    throw new ProblemException({
      type: 'not-the-assignee',
      title: 'Forbidden',
      status: HttpStatus.FORBIDDEN,
      detail: "Only the case's assignee can compose and issue its clarifications.",
    });
  }
}

const personId = z.uuid();

/**
 * The declarant's person id: the `person_id` claim of the token the global guard has verified in
 * this request (onboarded declarants carry it; staff tokens do not). Absent or malformed: null.
 */
export function declarantPersonOf(request: AuthenticatedRequest): string | null {
  const [, token] = request.headers.authorization?.split(' ') ?? [];
  const payload = token?.split('.')[1];
  if (!request.principal || !payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      person_id?: unknown;
    };
    const parsed = personId.safeParse(claims.person_id);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The declarant's person id; a caller without one gets 404, as if nothing existed. */
export const DeclarantPerson = createParamDecorator((_: unknown, context: ExecutionContext) =>
  notFoundIfInvisible(declarantPersonOf(context.switchToHttp().getRequest<AuthenticatedRequest>())),
);

/** Scope of service tokens allowed to call the review service's internal API. */
export const REVIEW_INTERNAL_SCOPE = 'review:internal';

type InternalRequest = AuthenticatedRequest & { actingTenant?: string };

/**
 * Admits service tokens carrying `review:internal` and reads the Commission they act for from
 * `X-Acting-Tenant`, trusted only because of the scope (ADR-013 §8.1).
 */
@Injectable()
export class ActingTenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<InternalRequest>();
    if (!request.principal?.scopes.includes(REVIEW_INTERNAL_SCOPE)) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Forbidden',
        status: HttpStatus.FORBIDDEN,
        detail: `Requires a service token with scope ${REVIEW_INTERNAL_SCOPE}.`,
      });
    }
    const header = request.headers[ACTING_TENANT_HEADER];
    const tenant = Array.isArray(header) ? undefined : header;
    if (!tenant || !TENANT_SLUG.test(tenant) || tenant === 'platform') {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Validation failed',
        status: HttpStatus.BAD_REQUEST,
        errors: [{ path: 'X-Acting-Tenant', message: 'Must name the tenant the call acts for' }],
      });
    }
    request.actingTenant = tenant;
    return true;
  }
}

/** Guards an internal route with `ActingTenantGuard` and documents it. */
export const InternalRoute = () =>
  applyDecorators(
    UseGuards(ActingTenantGuard),
    ApiHeader({
      name: 'X-Acting-Tenant',
      required: true,
      description: 'Commission the calling service acts for; the resource must belong to it',
      schema: { type: 'string', pattern: TENANT_SLUG.source },
    }),
    ApiProblemResponse(400, 'X-Acting-Tenant is missing or not a tenant key'),
    ApiProblemResponse(403, `Requires a service token with scope ${REVIEW_INTERNAL_SCOPE}`),
  );

/** The Commission `ActingTenantGuard` admitted the call for. */
export const ActingTenant = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const tenant = context.switchToHttp().getRequest<InternalRequest>().actingTenant;
  if (!tenant) throw new Error('ActingTenant used on a route without InternalRoute()');
  return tenant;
});
