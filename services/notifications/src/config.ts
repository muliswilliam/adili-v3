import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'notifications';
export const SERVICE_DESCRIPTION =
  'Email, SMS and in-app notifications, reminders and signed outbound webhooks.';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_FROM: z.string().min(1),
  SMS_GATEWAY_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
