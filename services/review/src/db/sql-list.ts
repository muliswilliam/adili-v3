import { type SQL, sql } from 'drizzle-orm';

/**
 * A list of string literals for a check constraint (`status in (...)`). For constants of the
 * schema only: the values are inlined, never escaped.
 */
export function inList(values: readonly string[]): SQL {
  return sql.raw(values.map((value) => `'${value}'`).join(', '));
}
