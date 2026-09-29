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
  /** The queue the reporting worker polls: `ComplianceReportWorkflow` runs here (ADR-013 §4). */
  TEMPORAL_TASK_QUEUE: z.string().min(1).default('reporting'),
  /** Base URL of the declarations service, whose internal API serves officer details. */
  DECLARATIONS_URL: z.url(),
  /** Base URL of the review service, whose internal API serves clarification details. */
  REVIEW_URL: z.url(),
  /** Base URL of the directory service, whose internal API serves Commissions and staff. */
  DIRECTORY_URL: z.url(),
  /** Base URL of the notifications service, which sends the draft-ready emails. */
  NOTIFICATIONS_URL: z.url(),
  /** Confidential Keycloak client whose service account calls other services' internal APIs. */
  KEYCLOAK_CLIENT_ID: z.string().min(1).default('reporting'),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
  /** OpenBao Transit, which wraps the data keys of the encrypted report snapshots (ADR-006). */
  OPENBAO_ADDR: z.url(),
  OPENBAO_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
