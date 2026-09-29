import { HttpStatus } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';

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
  throw new ProblemException({
    type: 'about:blank',
    title: 'Forbidden',
    status: HttpStatus.FORBIDDEN,
    detail: `Only a supervisor of the Commission can ${action}.`,
  });
}

/**
 * Only the Commission's commission-admin (standing in for the accounting officer) enters Part I
 * contact details and Part B, and confirms and submits; the supervisor and the reporting officer
 * get 403.
 */
export function requireCommissionAdmin(principal: Principal, action: string): void {
  if (principal.roles.includes(COMMISSION_ADMIN)) return;
  throw new ProblemException({
    type: 'about:blank',
    title: 'Forbidden',
    status: HttpStatus.FORBIDDEN,
    detail: `Only a commission-admin of the Commission can ${action}.`,
  });
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
  throw new ProblemException(
    {
      type: 'about:blank',
      title: 'Forbidden',
      status: HttpStatus.FORBIDDEN,
      detail: 'Confirm your identity again to submit the report.',
    },
    { code: 'step-up-required' },
  );
}
