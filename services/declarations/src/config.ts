import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'declarations';
export const SERVICE_DESCRIPTION =
  'Filing obligations, drafts, declarations, versions, household and financial statements.';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1),
  VALKEY_URL: z.url(),
  OPENBAO_ADDR: z.url(),
  OPENBAO_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
