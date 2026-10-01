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
  /** The queue the declarations worker polls (obligation workflows and their activities). */
  TEMPORAL_TASK_QUEUE: z.string().min(1).default('declarations'),
  VALKEY_URL: z.url(),
  OPENBAO_ADDR: z.url(),
  OPENBAO_TOKEN: z.string().min(1),
  /** The directory, whose internal API roster records, policies and Commission names come from. */
  DIRECTORY_API_URL: z.url(),
  /** The notifications service, which sends obligation reminders to a person. */
  NOTIFICATIONS_API_URL: z.url(),
  /** Where reminders send declarants to sign in (the portal). */
  PORTAL_URL: z.url(),
  /** Reminders are spread this many hours either side of midday (platform configuration). */
  REMINDER_JITTER_HOURS: z.coerce.number().min(0).max(12).default(6),
  /** The service's confidential Keycloak client (client credentials, `directory:internal`, `messages`). */
  KEYCLOAK_CLIENT_ID: z.string().min(1).default('declarations'),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);

/** How far a reminder is shifted either way from midday (`REMINDER_JITTER_HOURS`). */
export const REMINDER_JITTER_WINDOW_MS = config.REMINDER_JITTER_HOURS * 60 * 60 * 1000;
