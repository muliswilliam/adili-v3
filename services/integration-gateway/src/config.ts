import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'integration-gateway';
export const SERVICE_DESCRIPTION =
  'Adapters to IPRS, KRA, NTSA, BRS, ArdhiSasa, HR, payroll and ICMS with retries and circuit breakers.';

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
  /** Consecutive upstream failures that open a system's circuit. */
  BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  /** How long an open circuit fails fast before letting one probe through. */
  BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(30_000),
  /**
   * HMAC key for subject hashes (verification results, cache keys). National IDs are few enough
   * to enumerate, so an unkeyed hash would be reversible.
   */
  SUBJECT_HASH_KEY: z.string().min(32),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
