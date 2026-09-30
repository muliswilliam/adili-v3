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
   * Trusted proxies in front of the portal that append to X-Forwarded-For; see
   * server/client-ip.ts. Defaults to 1: every deployment serves the portal behind one edge proxy
   * (Traefik on Dokploy, the ingress on Kubernetes), and with 0 every browser would share that
   * proxy's address and so one per-IP rate limit. Must equal the real number of proxies: a
   * higher value lets a client pick its own address. Without a proxy (local dev) the header is
   * short and the socket address is used anyway.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  DECLARATIONS_API_URL: z.url(),
  DOCUMENTS_API_URL: z.url(),
  /**
   * Serve obligations, declaration drafts and uploads from in-memory fixtures, to work on the
   * portal without the services; drafts need it until they implement spec 05 (#115). Honoured
   * in `vite dev` and tests only; production builds do not contain the mocks.
   */
  DECLARATIONS_MOCK: z.stringbool().default(false),
  REVIEW_API_URL: z.url(),
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
