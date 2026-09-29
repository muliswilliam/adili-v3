import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'review';
export const SERVICE_DESCRIPTION =
  'Review cases, risk flags, clarifications, determinations, administrative actions and referrals.';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1),
  /** The queue the review worker polls: `DeclarationProcessingWorkflow` runs here (ADR-013 §4). */
  TEMPORAL_TASK_QUEUE: z.string().min(1).default('review'),
  /** Base URL of the declarations service, whose internal API serves submitted versions. */
  DECLARATIONS_URL: z.url(),
  /** Base URL of the directory service, whose internal API serves Commission policies. */
  DIRECTORY_URL: z.url(),
  /** Base URL of the documents service, whose internal API serves attachment downloads. */
  DOCUMENTS_URL: z.url(),
  /** Base URL of the notifications service, which sends clarification emails and SMS. */
  NOTIFICATIONS_URL: z.url(),
  /** Base URL of the integration-gateway, which sends salary stop and resume instructions. */
  INTEGRATION_GATEWAY_URL: z.url(),
  /** The declarant portal, linked from clarification letters and messages. */
  PORTAL_URL: z.url(),
  /** Confidential Keycloak client whose service account calls other services' internal APIs. */
  KEYCLOAK_CLIENT_ID: z.string().min(1).default('review'),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
  /**
   * Fraction of the cases eligible for bulk closure that the closure sweep diverts to a reviewer
   * instead of proposing their closure (spec 08; 0.02 is 2%).
   */
  CLOSURE_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.02),
  /**
   * When the daily closure sweep runs (cron, Nairobi time) on the Temporal schedule the service
   * keeps; `off` keeps no schedule (tests, local runs that start sweeps by hand).
   */
  CLOSURE_SWEEP_CRON: z.string().min(1).default('0 2 * * *'),
  /**
   * When the daily referral sweep runs (cron, Nairobi time) on the Temporal schedule the service
   * keeps; `off` keeps none.
   */
  REFERRAL_SWEEP_CRON: z.string().min(1).default('30 2 * * *'),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
