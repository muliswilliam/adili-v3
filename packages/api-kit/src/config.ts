import { z } from 'zod';

/** Environment every service needs. Services extend this with their own variables. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** The realm as its tokens name it (`iss`), e.g. `http://localhost:8080/realms/adili`. */
  OIDC_ISSUER_URL: z.url(),
  /**
   * The realm as this service reaches it, when that differs from the issuer: a Keycloak behind a
   * TLS proxy that the service reaches on loopback (the Azure demo). Signing keys, service tokens
   * and the admin API are fetched here; tokens are still checked against OIDC_ISSUER_URL. Unset,
   * the issuer is reached directly.
   */
  OIDC_INTERNAL_URL: z.url().optional(),
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

/** Where this service reaches the realm: OIDC_INTERNAL_URL, else the issuer itself. */
export function oidcRealmUrl(
  config: Pick<BaseEnv, 'OIDC_ISSUER_URL' | 'OIDC_INTERNAL_URL'>,
): string {
  return config.OIDC_INTERNAL_URL ?? config.OIDC_ISSUER_URL;
}

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
