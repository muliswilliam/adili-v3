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
    ...providerEnvShape,
  })
  .superRefine(checkProviderEnv)
  .transform(withProviderDefaults);

export type Env = z.output<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
