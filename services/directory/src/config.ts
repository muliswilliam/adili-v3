import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'directory';
export const SERVICE_DESCRIPTION =
  'Tenants, organisation hierarchy, people, employments, rosters, delegations, category rules and reference numbering.';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
  VALKEY_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
