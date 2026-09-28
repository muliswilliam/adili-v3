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
    /** Model for every task until the routing table (spec 07c BE-3) lands. */
    AI_MODEL: z.string().min(1).default('claude-opus-5-5'),
    /**
     * Days a finished job keeps its output. The calling service stores what it shows; after this
     * the job is only hashes and counts, and no longer serves the cache.
     */
    AI_OUTPUT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    ...providerEnvShape,
  })
  .superRefine(checkProviderEnv)
  .transform(withProviderDefaults);

export type Env = z.output<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
