import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import {
  ACTING_TENANT_HEADER,
  ApiProblemResponse,
  type AuthenticatedRequest,
  ProblemException,
} from '@adili/api-kit';

import { TENANT_SLUG } from '../cases/access.js';

/**
 * The review service's internal routes, called by other services with a service token (ADR-013):
 * the guard, route decorator and parameter they use. Mirrors documents' `internal/acting-tenant.ts`.
 */

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
