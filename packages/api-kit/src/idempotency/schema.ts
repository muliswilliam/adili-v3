import { index, integer, json, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Stored results of requests made with an `Idempotency-Key` (ADR-009). Every service with
 * idempotent routes includes this table in its schema, like the events tables.
 *
 * A row with a null `responseStatus` is a claim: the first request is still running.
 * `responseBody` is `json`, not `jsonb`, so a replay returns the body with its original key order.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text().notNull(),
    /** Keys are scoped per caller: the `sub` of the verified token. */
    principalSubject: text().notNull(),
    /** SHA-256 of method, URL and canonical JSON body. */
    requestHash: text().notNull(),
    responseStatus: integer(),
    responseBody: json(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.principalSubject] }),
    index('idempotency_keys_created_at_idx').on(table.createdAt),
  ],
);

export const idempotencySchema = { idempotencyKeys };
