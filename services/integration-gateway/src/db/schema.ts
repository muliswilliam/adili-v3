import { idempotencySchema } from '@adili/api-kit/schema';
import type { FieldEnvelope } from '@adili/data-access';
import { eventsSchema } from '@adili/events/schema';
import {
  boolean,
  date,
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
 * it in `X-Legal-Basis` (`HEADER_LEGAL_BASES`), except onboarding's, which the IPRS route records
 * itself.
 */
export const LEGAL_BASES = [
  /** Regs r.20(1)(b): compare the declaration with other sources (review cross-checks). */
  'regs-r20-1-b',
  /** Act s.35(5): verify a declaration. */
  'act-s35-5',
  /** ADR-014: confirm a declarant's identity against the roster at onboarding. */
  'adr-014-onboarding',
  /**
   * Spec 05b: the declarant asks, with their consent recorded, for registries to be checked about
   * themselves or their household, to pre-fill their own declaration.
   */
  'declarant-request',
] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

/**
 * Why a system is instructed (an act on it, not a read; ADR-008, ADR-009: only after a recorded
 * decision). Callers name it in `X-Legal-Basis`, as for lookups; each instruction route takes only
 * its own (`PAYROLL_LEGAL_BASES`, `ICMS_LEGAL_BASES`).
 */
export const INSTRUCTION_LEGAL_BASES = [
  /** A sanction of the Administrative Mechanisms' ladder: salary stoppage and its reinstatement. */
  'am-sanctions',
  /** Regs r.20: a Commission's referral of a non-compliant officer to EACC. */
  'regs-r20-referral',
] as const;
export type InstructionLegalBasis = (typeof INSTRUCTION_LEGAL_BASES)[number];

/** What payroll may be instructed on. */
export const PAYROLL_LEGAL_BASES = ['am-sanctions'] as const satisfies InstructionLegalBasis[];

/** What a referral may be registered with ICMS on. */
export const ICMS_LEGAL_BASES = ['regs-r20-referral'] as const satisfies InstructionLegalBasis[];

/** external/payroll.yaml `ActionEnum`. */
export const PAYROLL_ACTIONS = ['stop_salary', 'resume_salary'] as const;
export type PayrollAction = (typeof PAYROLL_ACTIONS)[number];

/**
 * How payroll acknowledged an instruction. external/payroll.yaml `StatusEnum` is only `accepted`
 * (the mock accepts every valid one); `pending` and `failed` are reserved for a payroll that
 * acknowledges asynchronously, as the internal contract publishes them.
 */
export const PAYROLL_STATUSES = ['accepted', 'pending', 'failed'] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

/**
 * How ICMS answered a referral (external/icms.yaml `StatusEnum`): ICMS registers a referral as it
 * receives it, with its case number.
 */
export const ICMS_STATUSES = ['registered'] as const;
export type IcmsStatus = (typeof ICMS_STATUSES)[number];

export const SYSTEM_CALL_OUTCOMES = ['answered', 'unavailable'] as const;
export type SystemCallOutcome = (typeof SYSTEM_CALL_OUTCOMES)[number];

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
    /**
     * What the lookup was for, as the caller named it (`X-Case-Ref`): the review case, or the
     * declaration for a `declarant-request` lookup.
     */
    caseRef: text(),
    /**
     * The platform person the lookup is for, as the caller named it (`X-Subject-Person`): the
     * case declarant, or the declarant who asked. A read of the stored result is audited as a read
     * of their data (ADR-008).
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
  // Spec 07b's data table names one index (system, subject_hash, created_at): the subject hash is
  // keyed by system already (`SubjectHasher`), so (subject_hash, checked_at) finds a subject's
  // lookups in one system as that would, and (system, checked_at) serves the coverage counts.
  (table) => [
    index('verification_results_system_checked_idx').on(table.system, table.checkedAt),
    index('verification_results_subject_idx').on(table.subjectHash, table.checkedAt),
  ],
);

/**
 * What platform administrators set per system (spec 07b): whether it is paused, by whom and
 * since when. The record of a pause; lookups read the pause flag in Valkey, which the service
 * restores from here on start. A system without a row was never paused.
 *
 * Spec 07b's data table also lists rate_limit_per_minute and cache_ttl_seconds here. They are
 * configuration instead (`<SYSTEM>_RATE_LIMIT_PER_MINUTE`, `<SYSTEM>_CACHE_TTL_SECONDS`, see
 * config.ts): user story 17 asks for them "as configuration" and the Integrations page says
 * "Rate limits and cache lifetimes are configuration; contact the platform team to change them",
 * so nobody sets them here, and one source keeps every instance's policy the same.
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

/**
 * One row per call to a system that is not a lookup (payroll instructions, ICMS referrals),
 * answered or not: what coverage counts for them, as it counts lookups from verification
 * results. Identifiers of nobody: a system, an outcome and a latency. A replay answered from the
 * stored instruction or registration is no call.
 */
export const systemCalls = pgTable(
  'system_calls',
  {
    id: uuid().primaryKey(),
    system: text({ enum: SYSTEMS }).notNull(),
    outcome: text({ enum: SYSTEM_CALL_OUTCOMES }).notNull(),
    /** Why the system did not answer; null when it did. */
    reason: text({ enum: UNAVAILABLE_REASONS }),
    latencyMs: integer().notNull(),
    /** OAuth client of the calling service (`azp`, else `sub`). */
    caller: text().notNull(),
    calledAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('system_calls_system_called_idx').on(table.system, table.calledAt)],
);

/**
 * A salary stoppage or reinstatement payroll acknowledged (spec 08), one row per instruction
 * reference: written only once payroll answered, so an instruction payroll never received is not
 * here. The officer is identified to payroll by personal number and national ID; here only by
 * their keyed hashes, enough to tell a replay from a different instruction under the same
 * reference. Payroll instructions act for no tenant (ADR-013 section 8.6): the employer is in the
 * instruction, and the reference (`ADM-...`) names the Commission.
 */
export const payrollInstructions = pgTable('payroll_instructions', {
  /** The `ADM` reference (stop), or it with `-R` (resume). */
  instructionReference: text().primaryKey(),
  action: text({ enum: PAYROLL_ACTIONS }).notNull(),
  employerCode: text().notNull(),
  /** HMAC of the personal number under SUBJECT_HASH_KEY. */
  personalNumberHash: text().notNull(),
  /** HMAC of the national ID under SUBJECT_HASH_KEY. */
  nationalIdHash: text().notNull(),
  effectiveDate: date({ mode: 'string' }).notNull(),
  status: text({ enum: PAYROLL_STATUSES }).notNull(),
  /** Payroll's own reference for the instruction; null until payroll gives one. */
  payrollReference: text(),
  /** When payroll received it, by payroll's clock; null until payroll says. */
  receivedAt: timestamp({ withTimezone: true }),
  /** When the gateway sent it (the call that payroll acknowledged). */
  sentAt: timestamp({ withTimezone: true }).notNull(),
  /** OAuth client of the calling service. */
  requestedBy: text().notNull(),
  legalBasis: text({ enum: INSTRUCTION_LEGAL_BASES }).notNull(),
  /** The review case the instruction is for, as the caller named it. */
  caseRef: text(),
});

/**
 * A referral ICMS registered (spec 09), one row per referral reference: written only once ICMS
 * answered, so a referral ICMS never received is not here. The declarant is identified to ICMS by
 * national ID and name; here only by the national ID's keyed hash, with the referring Commission
 * enough to tell a replay from another referral under the same reference. No name, grounds or
 * narrative: ICMS holds those. Acts for no tenant (ADR-013 section 8.7): the referring Commission
 * is in the referral, and its reference (`RFL-...`) names it.
 */
export const icmsReferrals = pgTable('icms_referrals', {
  /** The `RFL` reference. */
  referralReference: text().primaryKey(),
  /** The referring Commission's issuer code, e.g. `PSC`. */
  referringCommission: text().notNull(),
  /** HMAC of the declarant's national ID under SUBJECT_HASH_KEY. */
  nationalIdHash: text().notNull(),
  status: text({ enum: ICMS_STATUSES }).notNull(),
  /** ICMS's case number, e.g. `EACC/ICMS/2028/000123`. */
  caseNumber: text().notNull(),
  /** When ICMS registered it, by ICMS's clock. */
  registeredAt: timestamp({ withTimezone: true }).notNull(),
  /** When the gateway sent it (the call that ICMS answered). */
  sentAt: timestamp({ withTimezone: true }).notNull(),
  /** OAuth client of the calling service. */
  requestedBy: text().notNull(),
  legalBasis: text({ enum: INSTRUCTION_LEGAL_BASES }).notNull(),
  /** The record the referral is for, as the caller named it. */
  caseRef: text(),
});

/** Drizzle schema of the integration-gateway database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...idempotencySchema,
  verificationResults,
  integrationSettings,
  systemCalls,
  payrollInstructions,
  icmsReferrals,
};

export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
