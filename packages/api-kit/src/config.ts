import { z } from 'zod';

/** Environment every service needs. Services extend this with their own variables. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  OIDC_ISSUER_URL: z.url(),
  OIDC_AUDIENCE: z.string().min(1).default('adili-api'),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

/** Parses the environment once at startup and fails fast with every problem listed. */
export function loadConfig<TSchema extends z.ZodType>(
  schema: TSchema,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<TSchema> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
