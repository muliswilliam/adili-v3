import { PLATFORM_TENANT } from '@adili/api-kit';
import { type Database, withTenant } from '@adili/data-access';

import type { schema } from './schema.js';

export type GatewayDatabase = Database<typeof schema>;
export type GatewayTransaction = Parameters<Parameters<GatewayDatabase['transaction']>[0]>[0];

/** `app.subject` of work the gateway does on its own (job runs, sweeps, the seed). */
export const SYSTEM_SUBJECT = 'system:ai-gateway';

/**
 * Runs `work` in a transaction scoped to `tenant` (ADR-006): every tenant table is under FORCE
 * row-level security, so it sees and writes that tenant's rows only (and the default routes).
 * `subject` is who the work is for: the calling service, the platform admin, or the gateway.
 */
export function asTenant<T>(
  db: GatewayDatabase,
  tenant: string,
  work: (tx: GatewayTransaction) => Promise<T>,
  subject: string = SYSTEM_SUBJECT,
): Promise<T> {
  return withTenant(db, { tenant, subject }, work);
}

/**
 * Runs `work` in the platform context, which sees every tenant's rows: for work across tenants
 * (the admin lists, the routing table, the janitor) and for a job found by its id alone, before
 * its tenant is known.
 */
export function asPlatform<T>(
  db: GatewayDatabase,
  work: (tx: GatewayTransaction) => Promise<T>,
  subject: string = SYSTEM_SUBJECT,
): Promise<T> {
  return withTenant(db, { tenant: PLATFORM_TENANT, subject }, work);
}
