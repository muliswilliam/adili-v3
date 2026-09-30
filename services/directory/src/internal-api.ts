import { InternalApi, notFoundIfInvisible, type Principal } from '@adili/api-kit';
import type { TenantContext } from '@adili/data-access';
import { DIRECTORY_INTERNAL_SCOPE } from '@adili/roles';

/**
 * Guards an internal controller (under `/internal/v1`, never routed by the public entrypoint) for
 * services acting for a tenant: a token with `directory:internal` and the tenant in X-Acting-Tenant (ADR-013 §8.1). Read the tenant with
 * `@ActingTenant()` and pass it to `actingTenantContext`.
 */
export const DirectoryInternalApi = () => InternalApi(DIRECTORY_INTERNAL_SCOPE);

/**
 * The RLS context of a service's internal call about Commission `slug`, acting for `tenant`: that
 * Commission's. Another Commission's data is 404, as if it did not exist.
 */
export function actingTenantContext(
  principal: Principal,
  tenant: string,
  slug: string,
): TenantContext {
  notFoundIfInvisible(slug, () => tenant === slug);
  return { tenant: slug, subject: principal.subject };
}
