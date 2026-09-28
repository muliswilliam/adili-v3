import { notFoundIfInvisible, type Principal } from '@adili/api-kit';

/** Roles of a Commission's staff, who see their own Commission's obligations. */
export const COMMISSION_STAFF_ROLES = [
  'reporting-officer',
  'reviewer',
  'supervisor',
  'commission-admin',
] as const;

/** EACC's roles: counts of any Commission, never declarants. */
export const EACC_ROLES = ['eacc-analyst', 'eacc-supervisor'] as const;

export const PLATFORM_ADMIN = 'platform-admin';

/** `app.tenant` of reads across every Commission. */
export const PLATFORM_TENANT = 'platform';

/** A tenant key (Commission slug), as the directory issues them. */
export const TENANT_SLUG = /^[a-z][a-z0-9]{1,19}$/;

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
  const tenant = TENANT_SLUG.test(slug) ? staffTenant(principal, options) : null;
  return notFoundIfInvisible(tenant === PLATFORM_TENANT || tenant === slug ? tenant : null);
}
