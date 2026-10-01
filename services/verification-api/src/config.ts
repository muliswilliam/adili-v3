import { baseEnvSchema, loadConfig, rateLimitsSchema } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'verification-api';
export const SERVICE_DESCRIPTION =
  'Public document verification from a read-only, public-safe projection.';

/** The public lookup's per client IP budget (`RATE_LIMITS`). */
export const VERIFY_RATE_LIMIT = 'verify';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
  VALKEY_URL: z.url(),
  /**
   * Rate limits as `<group>=<limit>/<seconds>s` entries: `verify`, lookups per client IP (spec
   * 06: the 31st lookup from one address in a minute is refused).
   */
  RATE_LIMITS: rateLimitsSchema
    .prefault(`${VERIFY_RATE_LIMIT}=30/60s`)
    .refine((groups) => VERIFY_RATE_LIMIT in groups, {
      message: `Configure the group ${VERIFY_RATE_LIMIT}`,
    }),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
