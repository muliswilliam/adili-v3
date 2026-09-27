import type { NewEvent } from '@adili/events';

import type { CommissionType } from './representation.js';

/**
 * Events the directory publishes about Commissions (spec 01). Ids and non-sensitive facts only:
 * no names, emails or phone numbers (ADR-013 §3). The `tenant` extension is the Commission's slug.
 * Documented here until the AsyncAPI file lands.
 */

export const COMMISSION_CREATED = 'commission.created.v1';

export interface CommissionCreatedData extends Record<string, unknown> {
  commissionId: string;
  slug: string;
  type: CommissionType;
}

export function commissionCreated(data: CommissionCreatedData): NewEvent<CommissionCreatedData> {
  return { type: COMMISSION_CREATED, subject: data.commissionId, tenant: data.slug, data };
}

export const REPORTING_OFFICER_ASSIGNED = 'commission.reporting-officer.assigned.v1';

export interface ReportingOfficerAssignedData extends Record<string, unknown> {
  commissionId: string;
  assignmentId: string;
  /** The officer's account: the `sub` of their tokens. */
  keycloakUserId: string;
  /** The assignment this one replaced, or null for a first assignment. */
  replacedAssignmentId: string | null;
}

/** A reporting officer was assigned (or replaced) and sent one activation email. */
export function reportingOfficerAssigned(
  slug: string,
  data: ReportingOfficerAssignedData,
): NewEvent<ReportingOfficerAssignedData> {
  return { type: REPORTING_OFFICER_ASSIGNED, subject: data.commissionId, tenant: slug, data };
}
