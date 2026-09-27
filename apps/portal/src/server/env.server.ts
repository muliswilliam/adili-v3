import { bffEnvSchema, parseEnv } from '@adili/bff-auth';
import { z } from 'zod';

export const envSchema = bffEnvSchema.extend({
  DIRECTORY_API_URL: z.url(),
  /** Serve the onboarding endpoints from in-memory fixtures until the directory implements them (#67). */
  DIRECTORY_MOCK: z.stringbool().default(false),
  DECLARATIONS_API_URL: z.url().default('http://localhost:4002'),
  DOCUMENTS_API_URL: z.url().default('http://localhost:4006'),
  /** Serve declaration drafts and uploads from in-memory fixtures until the services implement spec 05 (#115). */
  DECLARATIONS_MOCK: z.stringbool().default(false),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated environment, parsed on first use so builds don't need runtime secrets. */
export function env(): Env {
  cached ??= parseEnv(envSchema);
  return cached;
}
