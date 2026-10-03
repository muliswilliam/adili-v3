import { sql } from 'drizzle-orm';

import type { Database } from '@adili/data-access';

/** What an advisory lock is taken with: a transaction (or the database, for one statement). */
type Executor = Pick<Database, 'execute'>;

/**
 * Takes the transaction-scoped advisory lock of one tenant's `setting` (its gate, its budget),
 * so concurrent changes apply, and are audited, one after the other. Locking the setting's row
 * would not do: a tenant's first change has no row to lock.
 */
export async function lockTenantSetting(
  tx: Executor,
  setting: 'gate' | 'budget' | 'routing',
  tenant: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`ai-gateway:${setting}:${tenant}`}, 0))`,
  );
}
