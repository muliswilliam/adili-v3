import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  mixin,
  type Type,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

import { ApiProblemResponse } from '../openapi.js';
import { ProblemException } from '../problem-details.filter.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';
import { ACTING_TENANT_HEADER } from './service-token-client.js';

/** Tenant keys (Commission slugs, `eacc`); `platform` is a reserved RLS context, not a tenant. */
const TENANT_PATTERN = /^[a-z][a-z0-9]{1,19}$/;
const PLATFORM_TENANT = 'platform';

type InternalRequest = AuthenticatedRequest & { actingTenant?: string };

/**
 * A guard admitting service tokens carrying `scope` and reading the tenant they act for from
 * `X-Acting-Tenant`. The header is trusted only because of the scope: a user token never gets
 * past it, whatever headers it sends (the recorded exception in ADR-013 §8.1).
 */
function actingTenantGuard(scope: string): Type<CanActivate> {
  @Injectable()
  class ActingTenantGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const request = context.switchToHttp().getRequest<InternalRequest>();
      if (!request.principal?.scopes.includes(scope)) {
        throw new ProblemException({
          type: 'about:blank',
          title: 'Forbidden',
          status: HttpStatus.FORBIDDEN,
          detail: `Requires a service token with scope ${scope}.`,
        });
      }
      const header = request.headers[ACTING_TENANT_HEADER];
      const tenant = Array.isArray(header) ? undefined : header;
      if (!tenant || !TENANT_PATTERN.test(tenant) || tenant === PLATFORM_TENANT) {
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
  return mixin(ActingTenantGuard);
}

/**
 * Guards an internal controller or route (under `/internal/v1`, never routed by the public
 * entrypoint) for services acting for a tenant: the token must carry `scope`, and
 * `X-Acting-Tenant` names the tenant, which `@ActingTenant()` reads. The route must still check
 * the resource belongs to that tenant (404 otherwise). Documents the header, the 400 and the 403.
 *
 * @example
 * @Controller('internal/v1/uploads')
 * @InternalApi('documents:internal')
 * export class InternalUploadsController {
 *   @Get(':id/download')
 *   download(@ActingTenant() tenant: string, @Param('id') id: string) {}
 * }
 */
export const InternalApi = (scope: string) =>
  applyDecorators(
    UseGuards(actingTenantGuard(scope)),
    ApiHeader({
      name: 'X-Acting-Tenant',
      required: true,
      description: 'Tenant the calling service acts for; the resource must belong to it',
      schema: { type: 'string', pattern: TENANT_PATTERN.source },
    }),
    ApiProblemResponse(HttpStatus.BAD_REQUEST, 'X-Acting-Tenant is missing or not a tenant key'),
    ApiProblemResponse(HttpStatus.FORBIDDEN, `Requires a service token with scope ${scope}`),
  );

/** The tenant `@InternalApi()` admitted the call for. */
export const ActingTenant = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const tenant = context.switchToHttp().getRequest<InternalRequest>().actingTenant;
  if (!tenant) throw new Error('ActingTenant used on a route without InternalApi()');
  return tenant;
});
