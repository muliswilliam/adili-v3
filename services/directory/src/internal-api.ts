import { InternalApi, notFoundIfInvisible, type Principal } from '@adili/api-kit';
import type { TenantContext } from '@adili/data-access';

/**
 * Scope of service tokens allowed to call the directory's internal API (a Keycloak client
 * scope): the services that pull what a directory event referred to (declarations). Routes under
 * `/internal/v1` are never routed by the public entrypoint.
 */
export const DIRECTORY_INTERNAL_SCOPE = 'directory:internal';

/**
 * Scope of the one service allowed to read a person's verified contacts (notifications, to send a
 * reminder). Contacts are personal data: `directory:internal` does not reach them (spec 04).
 */
export const DIRECTORY_PERSON_CONTACTS_SCOPE = 'directory:person-contacts';

/**
 * Guards an internal controller for services acting for a tenant: a token with
 * `directory:internal` and the tenant in X-Acting-Tenant (ADR-013 §8.1). Read the tenant with
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
