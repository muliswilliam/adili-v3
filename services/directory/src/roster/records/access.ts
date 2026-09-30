import { HttpStatus } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import type { TenantContext } from '@adili/data-access';
import { PLATFORM_ADMIN } from '@adili/roles';

import {
  canSeeCommission,
  PLATFORM_TENANT,
  REPORTING_OFFICER_ROLE,
} from '../../commissions/access.js';

/** Roles that read their own Commission's roster records. */
const OWN_RECORDS_ROLES = [REPORTING_OFFICER_ROLE, 'commission-admin'] as const;

/**
 * Roles that read roster records (spec #27 authorisation matrix): the Commission's reporting
 * officer and commission admin, and platform admins for every Commission (audited). EACC reads
 * summaries and imports only, never the roster's personal data (user story 42).
 */
export const RECORD_READ_ROLES = [...OWN_RECORDS_ROLES, PLATFORM_ADMIN] as const;

/**
 * The RLS context in which `principal` reads the roster records of Commission `slug`, or the
 * refusal: 404 when the Commission is not the caller's to see, 403 when they see it but not its
 * records (EACC). Decided here rather than left to RLS, because national readers query in the
 * `platform` context, which RLS lets through (decision 16).
 */
export function recordsReadContext(principal: Principal, slug: string): TenantContext {
  notFoundIfInvisible(slug, () => canSeeCommission(principal, slug));
  if (principal.roles.includes(PLATFORM_ADMIN)) {
    return { tenant: PLATFORM_TENANT, subject: principal.subject };
  }
  const ownRecords = principal.roles.some((role) =>
    (OWN_RECORDS_ROLES as readonly string[]).includes(role),
  );
  if (ownRecords && principal.tenant === slug) {
    return { tenant: slug, subject: principal.subject };
  }
  throw new ProblemException({
    type: 'about:blank',
    title: 'Forbidden',
    status: HttpStatus.FORBIDDEN,
    detail: "Your roles do not allow reading this Commission's roster records.",
  });
}
