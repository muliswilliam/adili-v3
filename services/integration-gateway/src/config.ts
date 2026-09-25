import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'integration-gateway';
export const SERVICE_DESCRIPTION =
  'Adapters to IPRS, KRA, NTSA, BRS, ArdhiSasa, HR, payroll and ICMS with retries and circuit breakers.';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1),
  MOCKS_BASE_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
