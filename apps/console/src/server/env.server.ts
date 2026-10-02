import { bffEnvSchema, parseEnv } from '@adili/bff-auth';
import { z } from 'zod';

export const envSchema = bffEnvSchema.extend({
  DIRECTORY_API_URL: z.url(),
  REVIEW_API_URL: z.url(),
  DOCUMENTS_API_URL: z.url(),
  DECLARATIONS_API_URL: z.url(),
  /** The integration-gateway's public routes: registry coverage for platform admins (spec 07b). */
  INTEGRATION_GATEWAY_API_URL: z.url(),
  /** The ai-gateway: AI policy, routing and usage for platform admins (spec 07c). */
  AI_GATEWAY_API_URL: z.url(),
  /** Base URL of the public API that Commissions' own systems (HR) call, shown in the API docs. */
  PUBLIC_API_URL: z.url(),
  /**
   * Serve review cases, clarifications and their letter and attachment downloads from in-memory
   * fixtures until the review service implements spec 07a (#174). Honoured in `vite dev` and
   * tests only; production builds do not contain the mock.
   */
  REVIEW_MOCK: z.stringbool().default(false),
  /**
   * With REVIEW_MOCK: `not-enabled` seeds every mock case's copilot as not enabled for the
   * Commission (the panel's and Draft with AI's disabled states); `ready` by default.
   */
  REVIEW_MOCK_COPILOT: z.enum(['ready', 'not-enabled']).default('ready'),
  /**
   * Serve the ai-gateway's policy, routing and usage endpoints from in-memory fixtures, so the
   * console runs without the gateway. Honoured in `vite dev` and tests only, like REVIEW_MOCK.
   */
  AI_GATEWAY_MOCK: z.stringbool().default(false),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated environment, parsed on first use so builds don't need runtime secrets. */
export function env(): Env {
  cached ??= parseEnv(envSchema);
  return cached;
}
