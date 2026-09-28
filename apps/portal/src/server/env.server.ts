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
  DECLARATIONS_API_URL: z.url().default('http://localhost:4002'),
  DOCUMENTS_API_URL: z.url().default('http://localhost:4006'),
  /**
   * Serve declaration drafts and uploads from in-memory fixtures until the services implement
   * spec 05 (#115). Honoured in `vite dev` and tests only; production builds do not contain the
   * mocks.
   */
  DECLARATIONS_MOCK: z.stringbool().default(false),
  REVIEW_API_URL: z.url().default('http://localhost:4003'),
  /**
   * Serve the declarant's clarifications from in-memory fixtures until the review service
   * implements spec 07a (#174). Attachments are checked against the documents mock, so turn on
   * DECLARATIONS_MOCK too. Honoured in `vite dev` and tests only, like the other mocks.
   */
  REVIEW_MOCK: z.stringbool().default(false),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated environment, parsed on first use so builds don't need runtime secrets. */
export function env(): Env {
  cached ??= parseEnv(envSchema);
  return cached;
}
