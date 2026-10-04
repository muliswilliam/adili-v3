import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

import {
  checkProviderEnv,
  providerEnvShape,
  withProviderDefaults,
} from './providers/provider-env.js';

export const SERVICE_NAME = 'ai-gateway';
export const SERVICE_DESCRIPTION =
  'AI task API with provider adapters, data-classification gate, prompt versions and budgets.';

export const envSchema = baseEnvSchema
  .extend({
    DATABASE_URL: z.url(),
    RABBITMQ_URL: z.url(),
    TEMPORAL_ADDRESS: z.string().min(1),
    TEMPORAL_NAMESPACE: z.string().min(1),
    /** Temporal task queue this service's activities and job workflows run on (ADR-013 §4). */
    AI_TASK_QUEUE: z.string().min(1).default('ai'),
    /**
     * Hours a finished job keeps its output, which holds declaration content with identifiers
     * restored: long enough for the calling service to collect it (it stores what it shows,
     * encrypted), no longer, since the gateway keeps hashes and audit, not content (spec 07c).
     * After this the job is only hashes and counts, and no longer serves the cache.
     */
    AI_OUTPUT_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
    OPENBAO_ADDR: z.url(),
    OPENBAO_TOKEN: z.string().min(1),
    /** Monthly tokens (in and out) of a tenant without a budget of its own. */
    AI_DEFAULT_MONTHLY_TOKENS: z.coerce.number().int().nonnegative().default(10_000_000),
    /** Task calls per minute of a tenant without a budget of its own. */
    AI_DEFAULT_PER_MINUTE: z.coerce.number().int().positive().default(60),
    /** Consecutive transport failures that open a provider's circuit breaker. */
    AI_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
    /** How long an open breaker fails calls fast before one probe call. */
    AI_BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(30_000),
    /**
     * Origins (`scheme://host:port`, comma-separated) the download link of a document a task
     * reads may point at: the documents store's (spec 05b). Any other link fails the job.
     */
    AI_DOCUMENT_ORIGINS: z
      .string()
      .default('http://localhost:8333')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url()).min(1)),
    /** Largest document a task reads: the documents service's upload limit. */
    AI_DOCUMENT_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(20 * 1024 * 1024),
    /** How long fetching a document may take. */
    AI_DOCUMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    ...providerEnvShape,
  })
  .superRefine(checkProviderEnv)
  .transform(withProviderDefaults);

export type Env = z.output<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
