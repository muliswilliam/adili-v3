import { notFoundIfInvisible, PLATFORM_TENANT, type Principal } from '@adili/api-kit';
import type { TenantContext } from '@adili/data-access';
import {
  ACCESS_OFFICER,
  AUDITOR,
  COMMISSION_STAFF_ROLES,
  HELPDESK,
  NATIONAL_ROLES,
} from '@adili/roles';

/** Every console role. Declarants have no access to directory administration (spec 01). */
export const STAFF_ROLES = [
  ...NATIONAL_ROLES,
  ...COMMISSION_STAFF_ROLES,
  ACCESS_OFFICER,
  AUDITOR,
  HELPDESK,
] as const satisfies readonly string[];

/** Roles that read every Commission; everyone else reads only their own tenant's. */
export const NATIONAL_READ_ROLES = NATIONAL_ROLES;

export function seesAllCommissions(principal: Principal): boolean {
  return principal.roles.some((role) => (NATIONAL_READ_ROLES as readonly string[]).includes(role));
}

export function canSeeCommission(principal: Principal, slug: string): boolean {
  return seesAllCommissions(principal) || principal.tenant === slug;
}

/**
 * The RLS context a principal's queries run in: `platform` for national readers, otherwise their
 * own tenant. A non-national principal whose token says `platform` (e.g. helpdesk) gets an
 * unmatchable context rather than platform-wide rows.
 */
export function tenantContextOf(principal: Principal): TenantContext {
  if (seesAllCommissions(principal)) {
    return { tenant: PLATFORM_TENANT, subject: principal.subject };
  }
  const tenant = principal.tenant && principal.tenant !== PLATFORM_TENANT ? principal.tenant : '';
  return { tenant, subject: principal.subject };
}

/**
 * The RLS context of work on Commission `slug` that only the Commission's own principals may do
 * (its reporting officer, its HR system): its tenant. Anyone else gets 404, as if the Commission
 * did not exist.
 */
export function ownTenantContext(principal: Principal, slug: string): TenantContext {
  notFoundIfInvisible(slug, () => principal.tenant === slug);
  return { tenant: slug, subject: principal.subject };
}
