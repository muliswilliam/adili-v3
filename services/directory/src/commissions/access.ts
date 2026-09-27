import type { Principal } from '@adili/api-kit';
import type { TenantContext } from '@adili/data-access';

/** RLS context of platform-wide principals; also a reserved tenant key. */
export const PLATFORM_TENANT = 'platform';

/** Every console role. Declarants have no access to directory administration (spec 01). */
export const STAFF_ROLES = [
  'platform-admin',
  'eacc-analyst',
  'eacc-supervisor',
  'reporting-officer',
  'reviewer',
  'supervisor',
  'commission-admin',
  'access-officer',
  'auditor',
  'helpdesk',
] as const satisfies readonly string[];

/** Roles that read every Commission; everyone else reads only their own tenant's. */
export const NATIONAL_READ_ROLES = [
  'platform-admin',
  'eacc-analyst',
  'eacc-supervisor',
] as const satisfies readonly string[];

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
