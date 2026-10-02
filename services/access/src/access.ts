import { notFoundIfInvisible, type Principal, TENANT_KEY } from '@adili/api-kit';
import {
  ACCESS_OFFICER,
  DECLARANT,
  EACC_ROLES,
  LAW_ENFORCEMENT,
  LAW_ENFORCEMENT_TENANT,
  SUPERVISOR,
} from '@adili/roles';

import { forbidden, problem } from './problems.js';

/**
 * Who may do what in the access service (spec 10 authorisation table). Roles say what a caller
 * may do (`@Roles`, 403); these helpers add which records they may see (404 for anything another
 * Commission or person owns, as if it did not exist) and the person or tenant their row-level
 * security context runs as.
 */

/** A Commission's roles that see its access requests: the access officer decides, the supervisor reads. */
export const COMMISSION_ACCESS_ROLES = [ACCESS_OFFICER, SUPERVISOR] as const;

/**
 * Who reaches the Commission's officer routes (`@Roles`): its access officer and supervisor, and
 * EACC, whose roles see nothing there (spec 10 S16): they get 404, as for another Commission's
 * requests, not 403.
 */
export const OFFICER_ROUTE_ROLES = [...COMMISSION_ACCESS_ROLES, ...EACC_ROLES] as const;

/**
 * The applicant's person record (token `person_id`), under which their requests are filed and
 * read. An applicant account without one has not finished onboarding: 403 `no-applicant-record`.
 */
export function applicantPersonId(principal: Principal): string {
  if (principal.personId !== null) return principal.personId;
  throw problem('no-applicant-record', 'The applicant account carries no person record.');
}

/** The declarant's person record (token `person_id`): their notices, history and copies. */
export function declarantPersonId(principal: Principal): string {
  const { personId } = principal;
  return notFoundIfInvisible(principal.roles.includes(DECLARANT) ? personId : null);
}

/**
 * The RLS tenant of a Commission's access work on `slug` (its queue, a request's officer view):
 * the caller's own Commission when it is `slug` and they are its access officer or supervisor.
 * Anyone else, EACC included, gets 404.
 */
export function commissionTenant(principal: Principal, slug: string): string {
  const own = principal.tenant;
  const allowed =
    own !== null &&
    own === slug &&
    TENANT_KEY.test(own) &&
    principal.roles.some((role) => (COMMISSION_ACCESS_ROLES as readonly string[]).includes(role));
  return notFoundIfInvisible(allowed ? own : null);
}

/**
 * The caller's Commission when they may see its access requests at all (access officer or
 * supervisor of a Commission); 404 otherwise. For routes addressed by request id.
 */
export function ownCommissionTenant(principal: Principal): string {
  return commissionTenant(principal, principal.tenant ?? '');
}

/**
 * Only the Commission's access officer acts on a request (resolves, verifies, decides); the
 * supervisor, who reads, gets 403.
 */
export function requireAccessOfficer(principal: Principal, action: string): void {
  if (principal.roles.includes(ACCESS_OFFICER)) return;
  throw forbidden(`Only an access officer of the Commission can ${action}.`);
}

/**
 * How an access officer's act names them where people read it (timelines, decisions, the
 * self-access register): their name from the token, else their role, never their account id.
 */
export function accessOfficerName(principal: Principal): string {
  return principal.name ?? 'Access officer';
}

/** A law enforcement officer: role `law-enforcement` on an account of the `lea` tenant. */
export function isLeaOfficer(principal: Principal): boolean {
  return principal.tenant === LAW_ENFORCEMENT_TENANT && principal.roles.includes(LAW_ENFORCEMENT);
}
