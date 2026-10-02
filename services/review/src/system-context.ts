import type { Database, TenantContext } from '@adili/data-access';
import { sql } from 'drizzle-orm';

import type { ReviewTransaction } from './cases/case-lookup.js';

/**
 * `app.subject` of the service's own transactions (consumers, workflows), and the acting subject
 * of its own reads of declaration content.
 */
export const SYSTEM_SUBJECT = 'system:review';

/** The RLS context of the service's own work for one tenant. */
export function systemContext(tenant: string): TenantContext {
  return { tenant, subject: SYSTEM_SUBJECT };
}

/** The transaction `consumeOnce` hands an event's work, opened on the untyped database. */
export type InboxTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The transaction of an event's inbox entry (`consumeOnce`), which is the review database's, typed
 * with its schema and acting for `tenant` as the service under row-level security until it ends.
 */
export async function withInboxTenant(
  inboxTx: InboxTransaction,
  tenant: string,
): Promise<ReviewTransaction> {
  const tx = inboxTx as unknown as ReviewTransaction;
  await tx.execute(
    sql`select set_config('app.tenant', ${tenant}, true), set_config('app.subject', ${SYSTEM_SUBJECT}, true)`,
  );
  return tx;
}
