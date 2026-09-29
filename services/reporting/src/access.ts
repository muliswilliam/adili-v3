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
 * Only the Commission's supervisor compiles a preview or recompiles; the commission-admin and
 * the reporting officer, who can see the draft, get 403.
 */
export function requireSupervisor(principal: Principal): void {
  if (principal.roles.includes(SUPERVISOR)) return;
  throw new ProblemException({
    type: 'about:blank',
    title: 'Forbidden',
    status: HttpStatus.FORBIDDEN,
    detail: 'Only a supervisor of the Commission can compile its Form M.',
  });
}
