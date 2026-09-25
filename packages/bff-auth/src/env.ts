import { z } from 'zod';

/** Environment every BFF (portal, console) needs to run the OIDC session flow. */
export const bffEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Public origin of this app, e.g. http://localhost:3010. Used for redirect URIs. */
  APP_URL: z.url(),
  OIDC_ISSUER_URL: z.url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  /** Valkey holds server-side sessions (architecture section 6). */
  VALKEY_URL: z.url(),
});

export type BffEnv = z.infer<typeof bffEnvSchema>;

/** Parses the environment once and fails fast with every problem listed. */
export function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  env: Record<string, string | undefined> = process.env,
): z.infer<TSchema> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
