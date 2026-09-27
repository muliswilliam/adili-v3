import { bffEnvSchema, parseEnv } from '@adili/bff-auth';
import { z } from 'zod';

export const envSchema = bffEnvSchema.extend({
  DIRECTORY_API_URL: z.url(),
  /**
   * Serve the directory from in-memory fixtures until it implements spec 03 (#67). Honoured in
   * `vite dev` and tests only; production builds do not contain the mock.
   */
  DIRECTORY_MOCK: z.stringbool().default(false),
  /**
   * Proxies in front of the portal that append to X-Forwarded-For (e.g. 1 behind one load
   * balancer). 0 ignores the header and uses the socket address; see server/client-ip.ts.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated environment, parsed on first use so builds don't need runtime secrets. */
export function env(): Env {
  cached ??= parseEnv(envSchema);
  return cached;
}
