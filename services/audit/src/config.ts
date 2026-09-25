import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'audit';
export const SERVICE_DESCRIPTION =
  'Tamper-evident, hash-chained audit trail with signed anchors and audit queries.';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
