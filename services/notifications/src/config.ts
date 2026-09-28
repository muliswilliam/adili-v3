import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'notifications';
export const SERVICE_DESCRIPTION =
  'Email, SMS and in-app notifications, reminders and signed outbound webhooks.';

export const envSchema = baseEnvSchema
  .extend({
    DATABASE_URL: z.url(),
    RABBITMQ_URL: z.url(),
    TEMPORAL_ADDRESS: z.string().min(1),
    TEMPORAL_NAMESPACE: z.string().min(1),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive(),
    SMTP_FROM: z.string().min(1),
    /** Refuse plaintext SMTP. Off only for local Mailpit, which has no TLS. */
    SMTP_REQUIRE_TLS: z.stringbool().default(false),
    SMS_GATEWAY_URL: z.url(),
    /** Alphanumeric sender shown on handsets; gateways cap it at 11 characters. */
    SMS_SENDER_ID: z.string().min(1).max(11),
    /**
     * HMAC key for recipient hashes. Phone numbers are few enough to enumerate, so an unkeyed
     * hash would be reversible; with the key, hashes still match per recipient for support lookups.
     */
    RECIPIENT_HASH_KEY: z.string().min(32),
    /**
     * The send budget: longest wait for a provider, and for a person recipient the contact
     * lookup too. Kept under the 5-second budget callers rely on.
     */
    PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().max(4_500).default(4_000),
    /** Base URL of the directory, whose internal API resolves a person's verified contacts. */
    DIRECTORY_URL: z.url(),
    /** Confidential Keycloak client whose service account reads contacts (`directory:internal`). */
    KEYCLOAK_CLIENT_ID: z.string().min(1).default('notifications'),
    KEYCLOAK_CLIENT_SECRET: z.string().min(1),
    /**
     * Longest wait for a person's contacts, token included. Spent from the send budget
     * (PROVIDER_TIMEOUT_MS), so a person recipient still answers within the 5 seconds.
     */
    CONTACT_LOOKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(1_000),
  })
  .refine((env) => env.CONTACT_LOOKUP_TIMEOUT_MS < env.PROVIDER_TIMEOUT_MS, {
    path: ['CONTACT_LOOKUP_TIMEOUT_MS'],
    message: 'must leave part of PROVIDER_TIMEOUT_MS for the provider',
  });

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
