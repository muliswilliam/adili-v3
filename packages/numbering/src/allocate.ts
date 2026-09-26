import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

import { format, keySegments } from './reference.js';
import { numberingCounters } from './schema.js';
import type { NumberingScheme } from './schemes.js';

/** The caller's transaction (or database) on a schema that includes `numberingSchema`. */
export type NumberingExecutor = Pick<PgDatabase<PgQueryResultHKT>, 'insert'>;

export interface CounterKey {
  issuer?: string;
  period?: number;
}

/**
 * Next sequence value of `scheme` for `key`, inside the caller's transaction. The counter row
 * stays locked until that transaction ends, so concurrent allocators queue behind it and a
 * rollback returns the number (gapless, ADR-011 §3). Use READ COMMITTED transactions: under
 * REPEATABLE READ or SERIALIZABLE, contended allocations fail with serialization errors.
 */
export async function allocate(
  tx: NumberingExecutor,
  scheme: NumberingScheme,
  key: CounterKey = {},
): Promise<number> {
  // Validate first so no counter exists for a key `format` would refuse.
  keySegments(scheme, key);
  const rows = await tx
    .insert(numberingCounters)
    .values({ scheme: scheme.code, issuer: key.issuer ?? '', period: key.period ?? 0, value: 1 })
    .onConflictDoUpdate({
      target: [numberingCounters.scheme, numberingCounters.issuer, numberingCounters.period],
      set: { value: sql`${numberingCounters.value} + 1` },
    })
    .returning({ value: numberingCounters.value });
  const [row] = rows;
  if (!row) throw new Error('counter upsert returned no row');
  return row.value;
}

/** Allocates the next number of `scheme` and formats it as a reference with check character. */
export async function allocateReference(
  tx: NumberingExecutor,
  scheme: NumberingScheme,
  key: CounterKey = {},
): Promise<string> {
  const sequence = await allocate(tx, scheme, key);
  return format(scheme, { ...key, sequence });
}
