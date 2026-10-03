import { HttpStatus } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException, TENANT_KEY } from '@adili/api-kit';
import { REVIEWER, SUPERVISOR } from '@adili/roles';

/**
 * The roles that work a Commission's review queue. Everyone else (declarants, helpdesk,
 * commission and platform admins, EACC) never reaches case content: 404, as if nothing existed.
 */
export const REVIEW_STAFF_ROLES = [REVIEWER, SUPERVISOR] as const;

/**
 * The tenant whose cases the caller works: their own Commission when they hold a review role
 * there; null otherwise.
 */
export function reviewTenant(principal: Principal): string | null {
  const own = principal.tenant;
  const reviews = principal.roles.some((role) =>
    (REVIEW_STAFF_ROLES as readonly string[]).includes(role),
  );
  return reviews && own !== null && TENANT_KEY.test(own) ? own : null;
}

/**
 * The RLS tenant of a read of Commission `slug`'s queue: the caller's own Commission when it is
 * `slug`; anything else is 404.
 */
export function queueTenant(principal: Principal, slug: string): string {
  const tenant = reviewTenant(principal);
  return notFoundIfInvisible(tenant !== null && tenant === slug ? tenant : null);
}

/**
 * The RLS tenant of work on a single case: the caller's own Commission when they review there.
 * Anyone else gets 404; a case of another Commission is then invisible under row-level security.
 */
export function caseTenant(principal: Principal): string {
  return notFoundIfInvisible(reviewTenant(principal));
}

export function isSupervisor(principal: Principal): boolean {
  return principal.roles.includes(SUPERVISOR);
}

/**
 * Approvals (the inbox, bulk closures) are the supervisors': a reviewer gets 403
 * `supervisor-required`.
 */
export function requireSupervisor(principal: Principal): void {
  if (isSupervisor(principal)) return;
  throw new ProblemException(
    {
      type: 'supervisor-required',
      title: 'Forbidden',
      status: HttpStatus.FORBIDDEN,
      detail: 'Approvals are for supervisors.',
    },
    { code: 'supervisor-required' },
  );
}

/**
 * 403 `not-the-assignee`: the case is someone else's to work. `detail` says what only its
 * assignee (or, where stated, a supervisor) may do.
 */
export function notTheAssignee(detail: string): ProblemException {
  return new ProblemException(
    { type: 'not-the-assignee', title: 'Forbidden', status: HttpStatus.FORBIDDEN, detail },
    { code: 'not-the-assignee' },
  );
}
