import { sql } from 'drizzle-orm';

import type { Database } from './database.js';

/** How often `truncateTables` tries before a lock held for good fails the suite. */
export const TRUNCATE_ATTEMPTS = 20;

/**
 * Postgres `lock_not_available` (55P03) or `deadlock_detected` (40P01), as the driver or drizzle's
 * wrapper reports it.
 */
export function isLockConflict(error: unknown): boolean {
  const codeOf = (value: unknown) =>
    typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined;
  const cause =
    typeof error === 'object' && error !== null && 'cause' in error ? error.cause : undefined;
  return [codeOf(error), codeOf(cause)].some((code) => code === '55P03' || code === '40P01');
}

/**
 * Empties `tables` between tests. An activity of a workflow an earlier test started may still
 * hold a lock: the truncate waits at most 2 s for it (a wait Postgres cannot see as a deadlock,
 * when the activity itself waits on a call back into the service) and, on a lock timeout or a
 * deadlock Postgres broke by aborting the truncate, is tried again, up to `TRUNCATE_ATTEMPTS`
 * times. A backstop: suites end the workflows they started first.
 */
export async function truncateTables<TSchema extends Record<string, unknown>>(
  db: Database<TSchema>,
  tables: readonly string[],
): Promise<void> {
  const list = sql.join(
    tables.map((table) => sql.identifier(table)),
    sql`, `,
  );
  for (let attempt = 1; ; attempt += 1) {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.execute(sql`truncate ${list}`);
      });
      return;
    } catch (error) {
      if (attempt >= TRUNCATE_ATTEMPTS || !isLockConflict(error)) throw error;
    }
  }
}
