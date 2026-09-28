import { baseEnvSchema, loadConfig, rateLimitsSchema } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'directory';
export const SERVICE_DESCRIPTION =
  'Tenants, organisation hierarchy, people, employments, rosters, delegations, category rules and reference numbering.';

const REQUIRED_RATE_LIMIT_GROUPS = [
  'roster-write',
  'roster-read',
  'onboarding-identify',
  'onboarding-identify-commission',
  'onboarding-session',
  'onboarding-commissions',
];

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
  /**
   * Public origin of the declarant portal, e.g. `https://adili.go.ke`: onboarding links to its
   * sign-in and recover-access routes, and set-password emails send declarants back here.
   */
  PORTAL_URL: z.url(),
  /**
   * Secret key (at least 32 characters) of the onboarding HMACs: one-time codes (keyed per
   * session) and client IP addresses stored with sessions. Rotating it invalidates codes in flight.
   */
  ONBOARDING_HMAC_KEY: z.string().min(32),
  /**
   * Failed identify attempts (`no-match`) against one Commission in one hour, from anyone, past
   * which the directory records `onboarding.abuse-threshold.v1` and logs a warning: a stale roster
   * or an attack.
   */
  ONBOARDING_ABUSE_THRESHOLD: z.coerce.number().int().positive().default(200),
  /**
   * Rate limits as `<group>=<limit>/<seconds>s` entries. The roster API's per client (ADR-009):
   * `roster-write` for starting imports and recording exits, `roster-read` for reading imports,
   * their rows and the summary; each HR system (and each console user) has its own budget. The
   * public onboarding routes' per client IP (spec 03): `onboarding-identify` per IP and
   * `onboarding-identify-commission` per IP and Commission for identify, `onboarding-session` for
   * every call on a session, `onboarding-commissions` for the Commission list.
   */
  RATE_LIMITS: rateLimitsSchema
    .prefault(
      'roster-write=120/60s,roster-read=600/60s,onboarding-identify=5/900s,onboarding-identify-commission=20/3600s,onboarding-session=120/60s,onboarding-commissions=60/60s',
    )
    .refine((groups) => REQUIRED_RATE_LIMIT_GROUPS.every((group) => group in groups), {
      message: `Configure the groups ${REQUIRED_RATE_LIMIT_GROUPS.join(', ')}`,
    }),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
