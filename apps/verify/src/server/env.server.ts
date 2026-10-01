import { z } from 'zod';

export const envSchema = z.object({
  /** The public verification API (verification-api, ADR-010). */
  VERIFICATION_API_URL: z.url().default('http://localhost:4007'),
  /**
   * Answer lookups from in-memory fixtures (server/verification/mock.server.ts) until
   * verification-api implements spec 06 (#146). Honoured in `vite dev` and tests only;
   * production builds do not contain the mock.
   */
  VERIFICATION_MOCK: z.stringbool().default(false),
  /**
   * Trusted proxies in front of the verify app that append to X-Forwarded-For; see `clientIp` in
   * @adili/api-kit/client. The browser's address goes to verification-api for its per-IP rate
   * limit. Defaults to 1, the edge proxy every deployment has; must equal the real number.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated environment, parsed on first use so builds don't need runtime settings. */
export function env(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}
