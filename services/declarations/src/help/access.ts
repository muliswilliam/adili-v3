import { HttpStatus } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException, TENANT_KEY } from '@adili/api-kit';
import { COMMISSION_ADMIN, REPORTING_OFFICER } from '@adili/roles';

/**
 * Who may do what with help articles (spec 11 authorisation): a Commission's administrators edit
 * its articles and its reporting officers read them; anyone else gets 404, as if the Commission
 * had none. Platform articles and the corpus import are platform-admin's (403 for others, by
 * `@Roles`); help search is the declarant's (404 for callers without a person).
 */

/** Whether the caller is staff of Commission `slug` in one of `roles`. */
function staffOf(principal: Principal, slug: string, roles: readonly string[]): boolean {
  return (
    TENANT_KEY.test(slug) &&
    principal.tenant === slug &&
    principal.roles.some((role) => roles.includes(role))
  );
}

/** The tenant whose articles the caller reads: their own Commission, as an administrator or reporting officer. */
export function articleReadTenant(principal: Principal, slug: string): string {
  return notFoundIfInvisible(
    staffOf(principal, slug, [COMMISSION_ADMIN, REPORTING_OFFICER]) ? slug : null,
  );
}

/**
 * The tenant whose articles the caller edits: their own Commission, as an administrator. A
 * reporting officer, who can read them, gets 403; anyone else 404.
 */
export function articleEditTenant(principal: Principal, slug: string): string {
  const tenant = articleReadTenant(principal, slug);
  if (!staffOf(principal, slug, [COMMISSION_ADMIN])) {
    throw new ProblemException({
      type: 'about:blank',
      title: 'Forbidden',
      status: HttpStatus.FORBIDDEN,
      detail: "Only the Commission's administrators edit its help articles.",
    });
  }
  return tenant;
}
