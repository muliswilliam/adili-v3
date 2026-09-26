import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'directory';
export const SERVICE_DESCRIPTION =
  'Tenants, organisation hierarchy, people, employments, rosters, delegations, category rules and reference numbering.';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
  VALKEY_URL: z.url(),
  /** Confidential Keycloak client whose service account provisions staff users. */
  KEYCLOAK_CLIENT_ID: z.string().min(1).default('directory'),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
