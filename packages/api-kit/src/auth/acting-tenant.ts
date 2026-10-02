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
import { ACTING_SUBJECT_HEADER, ACTING_TENANT_HEADER } from './service-token-client.js';

/**
 * A tenant key: a Commission slug, or `eacc`. `platform` matches it but is the reserved RLS
 * context of cross-tenant work, never a tenant (`PLATFORM_TENANT`).
 */
export const TENANT_KEY = /^[a-z][a-z0-9]{1,19}$/;
/** The reserved RLS context (`app.tenant`) of work across every tenant. */
export const PLATFORM_TENANT = 'platform';

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
      if (!tenant || !TENANT_KEY.test(tenant) || tenant === PLATFORM_TENANT) {
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
      schema: { type: 'string', pattern: TENANT_KEY.source },
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

/**
 * The raw `X-Acting-Subject` header of a call `@InternalApi()` admitted: whom the calling service
 * acts for. Give it the validation pipe the route needs (required or optional, and its shape).
 *
 * @example
 * read(@ActingSubject(new ZodValidationPipe(z.string().min(1).max(255))) subject: string) {}
 */
export const ActingSubject = createParamDecorator(
  (_: unknown, context: ExecutionContext): unknown => {
    const request = context.switchToHttp().getRequest<InternalRequest>();
    if (!request.actingTenant)
      throw new Error('ActingSubject used on a route without InternalApi()');
    return request.headers[ACTING_SUBJECT_HEADER];
  },
);
