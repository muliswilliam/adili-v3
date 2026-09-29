import { notFoundIfInvisible, PLATFORM_TENANT, type Principal, TENANT_KEY } from '@adili/api-kit';
import { COMMISSION_STAFF_ROLES, EACC_ROLES, PLATFORM_ADMIN } from '@adili/roles';

/** A Commission's issuer code until the directory has named it: its slug in capitals. */
export function fallbackIssuerCode(slug: string): string {
  return slug.toUpperCase();
}

/**
 * The Commission as last pulled from the directory; its issuer code alone (for code and name)
 * until a pull has named it.
 */
export function commissionRef(
  slug: string,
  known: { issuerCode: string | null; name: string | null } | undefined,
): { slug: string; issuerCode: string; name: string } {
  const issuerCode = known?.issuerCode ?? fallbackIssuerCode(slug);
  return { slug, issuerCode, name: known?.name ?? issuerCode };
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

/** The roles that read their Commission's declaration progress counts (#300). */
export const PROGRESS_ROLES = ['reporting-officer', 'commission-admin'] as const;

/**
 * The RLS tenant of a read of Commission `slug`'s declaration progress: the caller's own
 * Commission when they hold a `PROGRESS_ROLES` role there. Anyone else, platform admins and EACC
 * included, gets 404, as if it did not exist.
 */
export function progressReadTenant(principal: Principal, slug: string): string {
  const permitted =
    TENANT_KEY.test(slug) &&
    slug !== PLATFORM_TENANT &&
    principal.tenant === slug &&
    principal.roles.some((role) => (PROGRESS_ROLES as readonly string[]).includes(role));
  return notFoundIfInvisible(permitted ? slug : null);
}
