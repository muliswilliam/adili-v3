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
  /**
   * Public origin of the staff console, e.g. `https://console.adili.go.ke`. Activation emails
   * send staff here once they have completed their required actions; it must be a valid
   * redirect URI of the realm's `console` client.
   */
  CONSOLE_URL: z.url(),
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1),
  /** The queue the directory's worker polls: roster imports run here (ADR-013 §4). */
  TEMPORAL_TASK_QUEUE: z.string().min(1).default('directory'),
  /** Base URL of the documents service, whose internal API hands out clean roster files. */
  DOCUMENTS_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
