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
  /** The reporting service: Form M, EACC's intake and the national consolidated report (spec 09). */
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
   * Serve the reporting service (spec 09: a Commission's Form M periods and reports, EACC's intake
   * totals, its referrals intake with evidence package downloads and the national consolidated
   * report with its PDF download) from in-memory fixtures, for screens without the reporting
   * service and its upstreams running. Honoured in `vite dev` and tests only; production builds
   * do not contain the mock.
   */
  REPORTING_MOCK: z.stringbool().default(false),
  /**
   * With REPORTING_MOCK: the day (`YYYY-MM-DD`) the mock and the Form M workspace take as today,
   * to show the preview window (from 1 April) without waiting for it. Today by default.
   */
  REPORTING_MOCK_TODAY: z.iso.date().optional(),
  /**
   * With REPORTING_MOCK: where FY 2025/2026's national report starts. `not-built` by default;
   * `draft` built with a narrative by another analyst; `stale` that draft with one more report
   * received since; `approved` approved with its reference and PDF.
   */
  REPORTING_MOCK_NCR: z.enum(['not-built', 'draft', 'stale', 'approved']).default('not-built'),
  /**
   * With REVIEW_MOCK: `not-enabled` seeds every mock case's copilot as not enabled for the
   * Commission (the panel's and Draft with AI's disabled states); `ready` by default.
   */
  REVIEW_MOCK_COPILOT: z.enum(['ready', 'not-enabled']).default('ready'),
  /**
   * With REVIEW_MOCK: the first attempt of every bulk closure approval stops with a 503 before
   * this chunk (1-based), for the screen's stopped and Resume states (spec 08 #202). Off by default.
   */
  REVIEW_MOCK_CLOSURES_FAIL_AT_CHUNK: z.coerce.number().int().min(1).optional(),
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
