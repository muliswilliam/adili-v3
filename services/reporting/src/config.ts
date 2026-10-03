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
  /** Base URL of the documents service, which issues the Form M PDF and the receipt. */
  DOCUMENTS_URL: z.url(),
  /** Base URL of the integration-gateway, whose ICMS adapter registers EACC's referrals. */
  INTEGRATION_GATEWAY_URL: z.url(),
  /**
   * Pushing a referral to ICMS: how many times the gateway is tried while ICMS is unreachable,
   * and the pause before the second try (doubling for each later one), before the push is left
   * `push-failed` for EACC to push again.
   */
  ICMS_PUSH_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  ICMS_PUSH_BACKOFF_MS: z.coerce.number().int().min(0).default(500),
  /**
   * When the yearly compile runs (cron, Nairobi time): each Commission's draft for the financial
   * year that just ended, on 1 July. `off` keeps no schedule (tests).
   */
  ANNUAL_COMPILE_CRON: z.string().min(1).default('0 6 1 7 *'),
  /**
   * When EACC's chase of Commissions that have not reported starts (cron, Nairobi time): the
   * `NationalConsolidationWorkflow` of the financial year whose reports were due on 31 July, on
   * 1 August; it chases weekly from then. `off` keeps no schedule (tests).
   */
  NATIONAL_CHASE_CRON: z.string().min(1).default('0 6 1 8 *'),
  /**
   * EACC intake outliers: a Commission whose declared rate (declared / expected) in a section is
   * below its threshold is flagged `low-<section>-rate`. Fractions from 0 to 1.
   */
  INTAKE_MIN_INITIAL_RATE: z.coerce.number().min(0).max(1).default(0.8),
  INTAKE_MIN_BIENNIAL_RATE: z.coerce.number().min(0).max(1).default(0.8),
  INTAKE_MIN_FINAL_RATE: z.coerce.number().min(0).max(1).default(0.8),
  /**
   * S3-compatible object storage (ADR-002) and the bucket of the open-data releases' dataset
   * files (JSON and CSV per table, the release JSON).
   */
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_OPEN_DATA: z.string().min(1).default('open-data'),
  /** Confidential Keycloak client whose service account calls other services' internal APIs. */
  KEYCLOAK_CLIENT_ID: z.string().min(1).default('reporting'),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
  /** OpenBao Transit, which wraps the data keys of the encrypted report snapshots (ADR-006). */
  OPENBAO_ADDR: z.url(),
  OPENBAO_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
