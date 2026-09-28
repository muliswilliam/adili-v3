import { eventsSchema } from '@adili/events/schema';
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const SYSTEMS = ['iprs', 'kra', 'ntsa', 'brs', 'ardhisasa', 'payroll', 'icms'] as const;
export type System = (typeof SYSTEMS)[number];

export const LOOKUP_OUTCOMES = ['found', 'not-found', 'unavailable'] as const;
export type LookupOutcome = (typeof LOOKUP_OUTCOMES)[number];

export const UNAVAILABLE_REASONS = ['timeout', 'breaker-open', 'upstream-error'] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/**
 * One row per registry lookup, whether answered from the cache or the registry. Holds no
 * personal data: the subject is a keyed hash and the registry's answer is not stored.
 */
export const verificationResults = pgTable(
  'verification_results',
  {
    id: uuid().primaryKey(),
    system: text({ enum: SYSTEMS }).notNull(),
    /** HMAC of the looked-up identifier (e.g. the national ID) under SUBJECT_HASH_KEY. */
    subjectHash: text().notNull(),
    outcome: text({ enum: LOOKUP_OUTCOMES }).notNull(),
    /** Why the lookup was unavailable; null otherwise. */
    reason: text({ enum: UNAVAILABLE_REASONS }),
    cached: boolean().notNull(),
    latencyMs: integer().notNull(),
    /** OAuth client of the calling service (`azp`, else `sub`). */
    caller: text().notNull(),
    checkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('verification_results_system_checked_idx').on(table.system, table.checkedAt),
    index('verification_results_subject_idx').on(table.subjectHash, table.checkedAt),
  ],
);

/** Drizzle schema of the integration-gateway database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  verificationResults,
};

export * from '@adili/events/schema';
