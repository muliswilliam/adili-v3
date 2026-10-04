import { bffEnvSchema, parseEnv } from '@adili/bff-auth';
import { z } from 'zod';

/** How the Ask Adili mock's gateway can behave (`./declarations/mock/assistant.ts`). */
export const ASSISTANT_MOCK_MODES = ['ok', 'unavailable', 'fail-midway', 'rate-limited'] as const;

export const envSchema = bffEnvSchema.extend({
  DIRECTORY_API_URL: z.url(),
  /**
   * Serve the directory from in-memory fixtures until it implements spec 03 (#67). Honoured in
   * `vite dev` and tests only; production builds do not contain the mock.
   */
  DIRECTORY_MOCK: z.stringbool().default(false),
  /**
   * Trusted proxies in front of the portal that append to X-Forwarded-For; see `clientIp` in
   * @adili/api-kit/client. Defaults to 1: every deployment serves the portal behind one edge
   * proxy (Traefik on Dokploy, the ingress on Kubernetes), and with 0 every browser would share
   * that proxy's address and so one per-IP rate limit. Must equal the real number of proxies: a
   * higher value lets a client pick its own address. Without a proxy (local dev) the header is
   * short and the socket address is used anyway.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  DECLARATIONS_API_URL: z.url(),
  DOCUMENTS_API_URL: z.url(),
  /**
   * Serve the declarant's obligations (spec 04) from in-memory fixtures, to work on the portal
   * without the declarations service. Honoured in `vite dev` and tests only; production builds
   * do not contain the mocks.
   */
  OBLIGATIONS_MOCK: z.stringbool().default(false),
  /**
   * Serve declarations (drafts, submission, versions, amendments, acknowledgement slips) and
   * uploads from in-memory fixtures, to work on the portal without the declarations and documents
   * services. Independent of OBLIGATIONS_MOCK: with that off, drafts start from the real
   * service's obligations. Honoured in `vite dev` and tests only, like the other mocks.
   */
  DECLARATIONS_MOCK: z.stringbool().default(false),
  /**
   * Serve Ask Adili (conversations, streamed answers, feedback) and help search from in-memory
   * canned answers, to work on the panel without the declarations service's assistant and the
   * ai-gateway. Works with real drafts too. Honoured in `vite dev` and tests only, like the
   * other mocks.
   */
  ASSISTANT_MOCK: z.stringbool().default(false),
  /**
   * How the Ask Adili mock's gateway behaves, to see the panel's other states: `unavailable`
   * (help search), `fail-midway` (an answer that stops part-way), `rate-limited` (429).
   */
  ASSISTANT_MOCK_MODE: z.enum(ASSISTANT_MOCK_MODES).default('ok'),
  REVIEW_API_URL: z.url(),
  /**
   * Serve the declarant's clarifications from in-memory fixtures until the review service
   * implements spec 07a (#174). Attachments are checked against the documents mock, so turn on
   * DECLARATIONS_MOCK too. Honoured in `vite dev` and tests only, like the other mocks.
   */
  REVIEW_MOCK: z.stringbool().default(false),
  /**
   * With REVIEW_MOCK, how far the mock's clarification ladder has gone with the declarant's
   * salary (spec 08, #208): `none` stops at the warning; `stopped`, `disciplinary`,
   * `reinstating` and `reinstated` show the salary stoppage notices.
   */
  REVIEW_MOCK_SALARY: z
    .enum(['none', 'stopped', 'disciplinary', 'reinstating', 'reinstated'])
    .default('none'),
  ACCESS_API_URL: z.url(),
  /**
   * Serve the applicant's access requests (Form K, My requests, withdraw) and the Commissions
   * open to them from in-memory fixtures, to work on the portal without the access service.
   * Honoured in `vite dev` and tests only, like the other mocks.
   */
  ACCESS_MOCK: z.stringbool().default(false),
  /** The reporting service, whose public open-data API (spec 09b) the Open data page reads. */
  REPORTING_API_URL: z.url(),
  /**
   * Where the public reaches that API (the public gateway path), as the About this data page
   * documents it. Defaults to REPORTING_API_URL.
   */
  OPEN_DATA_API_PUBLIC_URL: z.url().optional(),
  /**
   * Serve the open-data releases and their tables from in-memory fixtures, to work on the Open
   * data page without the reporting service. Named for what it serves, the public open-data API
   * only: the portal reads nothing else from reporting. Honoured in `vite dev` and tests only, like the
   * other mocks.
   */
  OPEN_DATA_MOCK: z.stringbool().default(false),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated environment, parsed on first use so builds don't need runtime secrets. */
export function env(): Env {
  cached ??= parseEnv(envSchema);
  return cached;
}
