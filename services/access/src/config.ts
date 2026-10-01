import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'access';
export const SERVICE_DESCRIPTION =
  'Form K and law enforcement access requests, representations, decisions and grants.';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1),
  /**
   * The queue the access worker polls: `AccessRequestWorkflow` and `LeaRequestWorkflow` run here
   * (ADR-013 §4).
   */
  TEMPORAL_TASK_QUEUE: z.string().min(1).default('access'),
  /** Base URL of the directory service: Commissions, roster records, staff by role. */
  DIRECTORY_URL: z.url(),
  /** Base URL of the declarations service, which renders scoped disclosures and full documents. */
  DECLARATIONS_URL: z.url(),
  /** Base URL of the documents service: packages, certified copies, representation attachments. */
  DOCUMENTS_URL: z.url(),
  /** Base URL of the notifications service, which tells applicants, declarants and officers. */
  NOTIFICATIONS_URL: z.url(),
  /** The portal, where applicants and declarants sign in: the link in their messages. */
  PORTAL_URL: z.url(),
  /** Confidential Keycloak client whose service account calls other services' internal APIs. */
  KEYCLOAK_CLIENT_ID: z.string().min(1).default('access'),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
  /**
   * OpenBao Transit, which wraps the data keys of the encrypted Form K documents under the
   * Commission's key (ADR-006).
   */
  OPENBAO_ADDR: z.url(),
  OPENBAO_TOKEN: z.string().min(1),
  /** Days the access officer has to decide a Form K request from its receipt (Act s.36). */
  ACCESS_DECISION_DAYS: z.coerce.number().int().min(1).default(30),
  /** Days the access officer has to decide a law enforcement request from its receipt (r.23). */
  LEA_DECISION_DAYS: z.coerce.number().int().min(1).default(14),
  /**
   * Days the declarant has for representations once notified (Administrative Mechanisms 28-34);
   * a Commission policy may later set its own.
   */
  REPRESENTATION_WINDOW_DAYS: z.coerce.number().int().min(1).default(7),
  /** Days a granted package stays downloadable by its recipient (ADR-010 §6). */
  PACKAGE_DOWNLOAD_DAYS: z.coerce.number().int().min(1).default(14),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
