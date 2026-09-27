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
