import { idempotencySchema } from '@adili/api-kit/schema';
import type { FieldEnvelope } from '@adili/data-access';
import { eventsSchema } from '@adili/events/schema';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Every upstream the gateway calls. `hr-suppliers` is HR's employer supplier lists, asked for the
 * BRS employer-supplier check: an upstream of its own, so its outages, rate limit and pause never
 * touch BRS's.
 */
export const SYSTEMS = [
  'iprs',
  'kra',
  'ntsa',
  'brs',
  'ardhisasa',
  'hr-suppliers',
  'payroll',
  'icms',
] as const;
export type System = (typeof SYSTEMS)[number];

export const LOOKUP_OUTCOMES = ['found', 'not-found', 'unavailable'] as const;
export type LookupOutcome = (typeof LOOKUP_OUTCOMES)[number];

export const UNAVAILABLE_REASONS = [
  'timeout',
  'breaker-open',
  'paused',
  'rate-limited',
  'upstream-error',
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/**
 * Why a registry may be consulted (ADR-008: every lookup records its legal basis). Callers name
 * it in `X-Legal-Basis`.
 */
export const LEGAL_BASES = [
  /** Regs r.20(1)(b): compare the declaration with other sources (review cross-checks). */
  'regs-r20-1-b',
  /** Act s.35(5): verify a declaration. */
  'act-s35-5',
  /** ADR-014: confirm a declarant's identity against the roster at onboarding. */
  'adr-014-onboarding',
] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

/**
 * One row per registry lookup, whether answered from the cache or the registry. The subject is
 * a keyed hash; the registry's answer is kept only encrypted under the key of the tenant the
 * lookup acted for, and not at all for lookups that act for no tenant.
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
    /** Tenant the lookup acted for; null for lookups that act for no tenant. */
    tenant: text(),
    legalBasis: text({ enum: LEGAL_BASES }).notNull(),
    /** The review case (or other record) the lookup was for, as the caller named it. */
    caseRef: text(),
    /**
     * The platform person the lookup is about, as the caller named it (`X-Subject-Person`): a
     * read of the stored result is audited as a read of their data (ADR-008).
     */
    subjectPersonId: uuid(),
    /**
     * Base64 AES-256-GCM ciphertext of the normalised answer under the tenant's key, bound to the
     * row id. Only for `found` lookups that act for a tenant.
     */
    payloadCiphertext: text(),
    payloadEnvelope: jsonb().$type<FieldEnvelope>(),
    checkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('verification_results_system_checked_idx').on(table.system, table.checkedAt),
    index('verification_results_subject_idx').on(table.subjectHash, table.checkedAt),
  ],
);

/**
 * What platform administrators set per system (spec 07b): whether it is paused, by whom and
 * since when. The record of a pause; lookups read the pause flag in Valkey, which the service
 * restores from here on start. A system without a row was never paused.
 */
export const integrationSettings = pgTable('integration_settings', {
  system: text({ enum: SYSTEMS }).primaryKey(),
  paused: boolean().notNull().default(false),
  /** Subject of the platform administrator who paused it; null while not paused. */
  pausedBy: text(),
  /** Their display name at the time, for the Integrations page. */
  pausedByName: text(),
  pausedAt: timestamp({ withTimezone: true }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** Drizzle schema of the integration-gateway database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...idempotencySchema,
  verificationResults,
  integrationSettings,
};

export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
