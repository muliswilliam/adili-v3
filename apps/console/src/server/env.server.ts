import { bffEnvSchema, parseEnv } from '@adili/bff-auth';
import { z } from 'zod';

export const envSchema = bffEnvSchema.extend({
  DIRECTORY_API_URL: z.url(),
  REVIEW_API_URL: z.url(),
  DOCUMENTS_API_URL: z.url(),
  DECLARATIONS_API_URL: z.url(),
  /** The integration-gateway's public routes: registry coverage for platform admins (spec 07b). */
  INTEGRATION_GATEWAY_API_URL: z.url(),
  ACCESS_API_URL: z.url(),
  /** The reporting service: a Commission's Form M workspace (spec 09). */
  REPORTING_API_URL: z.url(),
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
   * Serve the access requests queue and requests (spec 10) from in-memory fixtures, for screens
   * without the access service and its upstreams running. Honoured in `vite dev` and tests only;
   * production builds do not contain the mock.
   */
  ACCESS_MOCK: z.stringbool().default(false),
  /**
   * Serve a Commission's Form M periods and reports (spec 09) from in-memory fixtures, for screens
   * without the reporting service and its upstreams running. Honoured in `vite dev` and tests
   * only; production builds do not contain the mock.
   */
  REPORTING_MOCK: z.stringbool().default(false),
  /**
   * With REPORTING_MOCK: the day (`YYYY-MM-DD`) the mock and the Form M workspace take as today,
   * to show the preview window (from 1 April) without waiting for it. Today by default.
   */
  REPORTING_MOCK_TODAY: z.iso.date().optional(),
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
  /**
   * Serve the declarations service's help endpoints (articles, corpus, help search, question
   * themes; spec 11) from in-memory fixtures, so the help pages run without the service.
   * Honoured in `vite dev` and tests only, like REVIEW_MOCK.
   */
  HELP_MOCK: z.stringbool().default(false),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated environment, parsed on first use so builds don't need runtime secrets. */
export function env(): Env {
  cached ??= parseEnv(envSchema);
  return cached;
}
