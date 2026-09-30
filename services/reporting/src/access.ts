import { notFoundIfInvisible, type Principal } from '@adili/api-kit';

import { forbidden } from './problems.js';

/** A tenant key (Commission slug), as the directory issues them. */
export const TENANT_SLUG = /^[a-z][a-z0-9]{1,19}$/;

export const SUPERVISOR = 'supervisor';
export const COMMISSION_ADMIN = 'commission-admin';
export const REPORTING_OFFICER = 'reporting-officer';

/**
 * The Commission roles that see its Form M workspace (spec 09 authorisation): the supervisor
 * compiles and reviews, the commission-admin and the reporting officer read. Everyone else,
 * EACC included, gets 404 on a Commission's drafts.
 */
export const FORM_M_ROLES = [SUPERVISOR, COMMISSION_ADMIN, REPORTING_OFFICER] as const;

/**
 * The RLS tenant of Form M work on Commission `slug`: the caller's own Commission when it is
 * `slug` and they hold a Form M role there. Anyone else gets 404, as if nothing existed.
 */
export function formMTenant(principal: Principal, slug: string): string {
  const own = principal.tenant;
  const allowed =
    own !== null &&
    own === slug &&
    TENANT_SLUG.test(own) &&
    principal.roles.some((role) => (FORM_M_ROLES as readonly string[]).includes(role));
  return notFoundIfInvisible(allowed ? own : null);
}

/**
 * Only the Commission's supervisor compiles a preview or recompiles, edits remarks and marks the
 * draft reviewed; the commission-admin and the reporting officer, who can see the draft, get 403.
 */
export function requireSupervisor(principal: Principal, action = 'compile its Form M'): void {
  if (principal.roles.includes(SUPERVISOR)) return;
  throw forbidden(`Only a supervisor of the Commission can ${action}.`);
}

/**
 * Only the Commission's commission-admin (standing in for the accounting officer) enters Part I
 * contact details and Part B, and confirms and submits; the supervisor and the reporting officer
 * get 403.
 */
export function requireCommissionAdmin(principal: Principal, action: string): void {
  if (principal.roles.includes(COMMISSION_ADMIN)) return;
  throw forbidden(`Only a commission-admin of the Commission can ${action}.`);
}

/** The level of authentication Keycloak's step-up re-authentication issues tokens at (ADR-004). */
export const STEP_UP_ACR = 'step-up';

/** How recent the step-up re-authentication must be (spec 06): five minutes. */
export const STEP_UP_MAX_AGE_SECONDS = 5 * 60;

/**
 * A legal act (confirming Form M) needs a fresh identity check: a token issued by the step-up
 * flow (`acr`) whose authentication (`auth_time`) is at most five minutes old at `now`. Otherwise
 * 403 `step-up-required`, and the console sends the officer through the step-up round trip.
 */
export function requireStepUp(principal: Principal, now: Date): void {
  const age = principal.authTime === undefined ? null : now.getTime() / 1000 - principal.authTime;
  if (principal.acr === STEP_UP_ACR && age !== null && age <= STEP_UP_MAX_AGE_SECONDS) return;
  throw forbidden('Confirm your identity again to submit the report.', 'step-up-required');
}

/**
 * The Commission a federated system's token (`reports:submit`, client credentials) files for: its
 * `tenant` claim. A token that names no Commission gets 403.
 */
export function federatedTenant(principal: Principal): string {
  const { tenant } = principal;
  if (tenant !== null && TENANT_SLUG.test(tenant)) return tenant;
  throw forbidden('The token is not issued for a Commission.');
}

/** The tenant of EACC's accounts, and the RLS context its intake reads every Commission's in. */
export const EACC_TENANT = 'eacc';

export const EACC_ANALYST = 'eacc-analyst';
export const EACC_SUPERVISOR = 'eacc-supervisor';

/** EACC's roles (spec 09 authorisation): the intake, chase status, and every submitted report. */
export const EACC_ROLES = [EACC_ANALYST, EACC_SUPERVISOR] as const;

/** An EACC account: an EACC role, acting for EACC. */
export function isEacc(principal: Principal): boolean {
  return (
    principal.tenant === EACC_TENANT &&
    principal.roles.some((role) => (EACC_ROLES as readonly string[]).includes(role))
  );
}

/**
 * EACC's intake and chase status are for EACC's analysts and supervisors only; anyone else,
 * Commission staff included, gets 403.
 */
export function requireEacc(
  principal: Principal,
  detail = 'Only EACC analysts and supervisors see the compliance report intake.',
): void {
  if (isEacc(principal)) return;
  throw forbidden(detail);
}

/**
 * Only an EACC supervisor approves the national consolidated report (spec 09 authorisation);
 * EACC analysts and everyone else get 403.
 */
export function requireEaccSupervisor(principal: Principal, action: string): void {
  if (principal.tenant === EACC_TENANT && principal.roles.includes(EACC_SUPERVISOR)) return;
  throw forbidden(`Only an EACC supervisor can ${action}.`);
}

/**
 * Who may read a submitted report and in which RLS tenant (spec 09 authorisation, "read submitted
 * report and receipt"): EACC's analysts and supervisors read every Commission's, in EACC's
 * tenant; a Commission's supervisor, commission-admin and reporting officer, and its own federated
 * system (`federatedScope`), read their own Commission's only. Anyone else gets 404.
 */
export function submittedReportReader(
  principal: Principal,
  federatedScope: string,
): { tenant: string; everyCommission: boolean } {
  if (isEacc(principal)) return { tenant: EACC_TENANT, everyCommission: true };
  const own = principal.tenant;
  const commission =
    own !== null &&
    TENANT_SLUG.test(own) &&
    (principal.roles.some((role) => (FORM_M_ROLES as readonly string[]).includes(role)) ||
      principal.scopes.includes(federatedScope));
  return { tenant: notFoundIfInvisible(commission ? own : null), everyCommission: false };
}
