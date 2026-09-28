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

/** Scope of service tokens allowed to call documents' internal API (Keycloak client scope). */
export const DOCUMENTS_INTERNAL_SCOPE = 'documents:internal';

/** Tenant keys (Commission slugs, `eacc`); `platform` is a reserved RLS context, not a tenant. */
const TENANT_PATTERN = /^[a-z][a-z0-9]{1,19}$/;
const PLATFORM_TENANT = 'platform';

type InternalRequest = AuthenticatedRequest & { actingTenant?: string };

/**
 * Admits service tokens carrying `documents:internal` and reads the tenant they act for from
 * `X-Acting-Tenant`. The header is trusted only because of the scope: a user token never gets
 * past this guard, whatever headers it sends (the recorded exception in ADR-013 §8.1).
 */
@Injectable()
export class ActingTenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<InternalRequest>();
    if (!request.principal?.scopes.includes(DOCUMENTS_INTERNAL_SCOPE)) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Forbidden',
        status: HttpStatus.FORBIDDEN,
        detail: `Requires a service token with scope ${DOCUMENTS_INTERNAL_SCOPE}.`,
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

/** Guards an internal controller or route with `ActingTenantGuard` and documents it. */
export const InternalApi = () =>
  applyDecorators(
    UseGuards(ActingTenantGuard),
    ApiHeader({
      name: 'X-Acting-Tenant',
      required: true,
      description: 'Tenant the calling service acts for; the resource must belong to it',
      schema: { type: 'string', pattern: TENANT_PATTERN.source },
    }),
    ApiProblemResponse(400, 'X-Acting-Tenant is missing or not a tenant key'),
    ApiProblemResponse(403, `Requires a service token with scope ${DOCUMENTS_INTERNAL_SCOPE}`),
  );

/** The tenant `ActingTenantGuard` admitted the call for. */
export const ActingTenant = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const tenant = context.switchToHttp().getRequest<InternalRequest>().actingTenant;
  if (!tenant) throw new Error('ActingTenant used on a route without InternalApi()');
  return tenant;
});
