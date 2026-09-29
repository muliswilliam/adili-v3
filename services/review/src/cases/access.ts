import { notFoundIfInvisible, type Principal } from '@adili/api-kit';

/**
 * The roles that work a Commission's review queue. Everyone else (declarants, helpdesk,
 * commission and platform admins, EACC) never reaches case content: 404, as if nothing existed.
 */
export const REVIEW_STAFF_ROLES = ['reviewer', 'supervisor'] as const;

export const SUPERVISOR = 'supervisor';

/** A tenant key (Commission slug), as the directory issues them. */
export const TENANT_SLUG = /^[a-z][a-z0-9]{1,19}$/;

/**
 * The tenant whose cases the caller works: their own Commission when they hold a review role
 * there; null otherwise.
 */
export function reviewTenant(principal: Principal): string | null {
  const own = principal.tenant;
  const reviews = principal.roles.some((role) =>
    (REVIEW_STAFF_ROLES as readonly string[]).includes(role),
  );
  return reviews && own !== null && TENANT_SLUG.test(own) ? own : null;
}

/**
 * The RLS tenant of a read of Commission `slug`'s queue: the caller's own Commission when it is
 * `slug`; anything else is 404.
 */
export function queueTenant(principal: Principal, slug: string): string {
  const tenant = reviewTenant(principal);
  return notFoundIfInvisible(tenant !== null && tenant === slug ? tenant : null);
}
