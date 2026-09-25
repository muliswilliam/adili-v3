import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'reporting';
export const SERVICE_DESCRIPTION =
  'Form M compliance reports, national consolidation, read models and open-data aggregates.';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
