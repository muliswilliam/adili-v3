import { notFoundIfInvisible, PLATFORM_TENANT, type Principal, TENANT_KEY } from '@adili/api-kit';
import { COMMISSION_STAFF_ROLES, EACC_ROLES, PLATFORM_ADMIN } from '@adili/roles';

/** A Commission's issuer code until the directory has named it: its slug in capitals. */
export function fallbackIssuerCode(slug: string): string {
  return slug.toUpperCase();
}

/**
 * The tenant whose obligations a staff caller reads: `platform` (every Commission) for platform
 * admins, and for EACC when only `counts` are read; the caller's own Commission for its staff;
 * null for anyone else.
 */
export function staffTenant(
  principal: Principal,
  { counts = false }: { counts?: boolean } = {},
): string | null {
  const holds = (roles: readonly string[]) => principal.roles.some((role) => roles.includes(role));
  if (holds([PLATFORM_ADMIN])) return PLATFORM_TENANT;
  if (counts && holds(EACC_ROLES)) return PLATFORM_TENANT;
  const own = principal.tenant;
  return holds(COMMISSION_STAFF_ROLES) && own !== null && own !== PLATFORM_TENANT ? own : null;
}

/**
 * The RLS tenant of a staff read of Commission `slug`: as `staffTenant`, but another Commission,
 * or a slug that cannot be one, is 404, as if it did not exist.
 */
export function commissionReadTenant(
  principal: Principal,
  slug: string,
  options: { counts?: boolean } = {},
): string {
  const tenant = TENANT_KEY.test(slug) ? staffTenant(principal, options) : null;
  return notFoundIfInvisible(tenant === PLATFORM_TENANT || tenant === slug ? tenant : null);
}
