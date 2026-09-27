import { bigint, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/**
 * One gapless counter per (scheme, issuer, period) (ADR-011 §3). Schemes without an issuer or
 * period store `''` and `0`, so every counter has a plain primary key. Every service that
 * issues reference numbers includes this table in its own schema.
 */
export const numberingCounters = pgTable(
  'numbering_counters',
  {
    scheme: text().notNull(),
    issuer: text().notNull().default(''),
    period: integer().notNull().default(0),
    /** Last number issued. */
    value: bigint({ mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.scheme, table.issuer, table.period] })],
);

export const numberingSchema = { numberingCounters };
