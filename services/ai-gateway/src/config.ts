import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

import { providerEnvShape, requireAnthropicKey } from './providers/provider.module.js';

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
  .superRefine(requireAnthropicKey);

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
