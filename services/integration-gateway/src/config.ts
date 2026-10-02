import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'integration-gateway';
export const SERVICE_DESCRIPTION =
  'Adapters to IPRS, KRA, NTSA, BRS, ArdhiSasa, HR, payroll and ICMS with retries and circuit breakers.';

const timeoutMs = z.coerce.number().int().positive().max(10_000).default(2_000);
const cacheTtlSeconds = z.coerce.number().int().positive().default(86_400);
const ratePerMinute = z.coerce.number().int().positive().default(600);

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1),
  VALKEY_URL: z.url(),
  /** Simulated government systems (mocks/); each adapter appends its own path. */
  MOCKS_BASE_URL: z.url(),
  /** IPRS base URL, ending before `/v1` (the mock serves it under `/iprs`). */
  IPRS_BASE_URL: z.url(),
  /** Longest wait for IPRS. Onboarding waits on it, so it is short and never retried here. */
  IPRS_TIMEOUT_MS: z.coerce.number().int().positive().max(10_000).default(2_000),
  /** How long an IPRS answer (found or not found) is reused. */
  IPRS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  /** Calls per minute IPRS is sent, across every instance; one second's worth may burst. */
  IPRS_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(1_200),
  /** Registry base URLs, each ending before `/v1` (the mocks serve them under `/<system>`). */
  KRA_BASE_URL: z.url(),
  NTSA_BASE_URL: z.url(),
  BRS_BASE_URL: z.url(),
  ARDHISASA_BASE_URL: z.url(),
  /** HR, for employers' supplier lists (the BRS employer-supplier check, system `hr-suppliers`). */
  HR_BASE_URL: z.url(),
  /**
   * Per registry: longest wait for one lookup (every call it makes), how long an answer (found
   * or not found) is reused, and calls per minute across every instance. Rate defaults are sized
   * from the database-sizing note (about 7.5M lookups a cycle, 10x burst headroom); tune them
   * with each registry.
   */
  KRA_TIMEOUT_MS: timeoutMs,
  KRA_CACHE_TTL_SECONDS: cacheTtlSeconds,
  KRA_RATE_LIMIT_PER_MINUTE: ratePerMinute,
  NTSA_TIMEOUT_MS: timeoutMs,
  NTSA_CACHE_TTL_SECONDS: cacheTtlSeconds,
  NTSA_RATE_LIMIT_PER_MINUTE: ratePerMinute,
  BRS_TIMEOUT_MS: timeoutMs,
  BRS_CACHE_TTL_SECONDS: cacheTtlSeconds,
  BRS_RATE_LIMIT_PER_MINUTE: ratePerMinute,
  ARDHISASA_TIMEOUT_MS: timeoutMs,
  ARDHISASA_CACHE_TTL_SECONDS: cacheTtlSeconds,
  ARDHISASA_RATE_LIMIT_PER_MINUTE: ratePerMinute,
  HR_SUPPLIERS_TIMEOUT_MS: timeoutMs,
  HR_SUPPLIERS_CACHE_TTL_SECONDS: cacheTtlSeconds,
  HR_SUPPLIERS_RATE_LIMIT_PER_MINUTE: ratePerMinute,
  /**
   * Longest a lookup queues for its system's rate limit before it is answered unavailable
   * (`rate-limited`) instead.
   */
  RATE_LIMIT_MAX_WAIT_MS: z.coerce.number().int().nonnegative().max(10_000).default(1_000),
  /** Consecutive upstream failures that open a system's circuit. */
  BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  /** How long an open circuit fails fast before letting one probe through. */
  BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(30_000),
  /**
   * HMAC key for subject hashes (verification results, cache keys). National IDs are few enough
   * to enumerate, so an unkeyed hash would be reversible.
   */
  SUBJECT_HASH_KEY: z.string().min(32),
  /** OpenBao Transit, whose tenant keys encrypt stored lookup answers (ADR-006). */
  OPENBAO_ADDR: z.url(),
  OPENBAO_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
