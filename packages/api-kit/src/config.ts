import { z } from 'zod';

/** Environment every service needs. Services extend this with their own variables. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  OIDC_ISSUER_URL: z.url(),
  OIDC_AUDIENCE: z.string().min(1).default('adili-api'),
  /**
   * Addresses of the proxies in front of the service whose X-Forwarded-For entries are
   * believed: comma-separated IPs, CIDRs or the names `loopback`, `linklocal` and `uniquelocal`.
   * The client address (`request.ip`, which per-IP rate limits count by) is the right-most
   * entry not from a trusted proxy, so entries a client makes up are ignored. By default the
   * private networks the BFFs and the edge proxy run on (`TRUSTED_PROXIES_DEFAULT`); empty
   * trusts none and uses the socket address.
   */
  TRUSTED_PROXIES: z.string().optional(),
});

export const TRUSTED_PROXIES_DEFAULT = 'loopback,linklocal,uniquelocal';

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
