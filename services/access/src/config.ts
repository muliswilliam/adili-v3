import {
  baseEnvSchema,
  demoModeSetting,
  demoWindowSetting,
  loadConfig,
  refuseDemoWindowsOutsideDemo,
} from '@adili/api-kit';
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
  /** Base URL of the review service, which discloses the clarifications a Form K grant includes. */
  REVIEW_URL: z.url(),
  /** Base URL of the notifications service, which tells applicants, declarants and officers. */
  NOTIFICATIONS_URL: z.url(),
  /** The portal, where applicants and declarants sign in: the link in their messages. */
  PORTAL_URL: z.url(),
  /** The console, where access officers sign in: the link in their reminders. */
  CONSOLE_URL: z.url(),
  /** Confidential Keycloak client whose service account calls other services' internal APIs. */
  KEYCLOAK_CLIENT_ID: z.string().min(1).default('access'),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
  /**
   * OpenBao Transit, which wraps the data keys of the encrypted Form K documents under the
   * Commission's key (ADR-006).
   */
  OPENBAO_ADDR: z.url(),
  OPENBAO_TOKEN: z.string().min(1),
  /**
   * Days the Commission has to provide the certified copy a written self-access application asks
   * for, from its receipt (Administrative Mechanism 32).
   */
  SELF_ACCESS_DAYS: z.coerce.number().int().min(1).default(14),
  /** Demo stack only (#371): allows the demo window below. Off by default. */
  DEMO_MODE: demoModeSetting,
  /**
   * Demo only: how long a grant's document stays in force (ISO-8601 duration, e.g. `PT2M`) instead
   * of its download window, for documents issued while it is set. Unset: the window.
   */
  DEMO_PACKAGE_VALIDITY: demoWindowSetting,
});

export const checkedEnvSchema = envSchema.superRefine((env, ctx) => {
  refuseDemoWindowsOutsideDemo(env, ['DEMO_PACKAGE_VALIDITY'], ctx);
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(checkedEnvSchema);
