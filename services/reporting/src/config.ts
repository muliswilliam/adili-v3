import { baseEnvSchema, loadConfig, rateLimitsSchema } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'reporting';
export const SERVICE_DESCRIPTION =
  'Form M compliance reports, national consolidation, read models and open-data aggregates.';

/** The public open-data API's per client IP budget (`RATE_LIMITS`). */
export const OPEN_DATA_RATE_LIMIT = 'open-data';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1),
  /** The queue the reporting worker polls: `ComplianceReportWorkflow` runs here (ADR-013 §4). */
  TEMPORAL_TASK_QUEUE: z.string().min(1).default('reporting'),
  /** Base URL of the declarations service, whose internal API serves officer details. */
  DECLARATIONS_URL: z.url(),
  /** Base URL of the review service, whose internal API serves clarification details. */
  REVIEW_URL: z.url(),
  /** Base URL of the directory service, whose internal API serves Commissions and staff. */
  DIRECTORY_URL: z.url(),
  /** Base URL of the notifications service, which sends the draft-ready emails. */
  NOTIFICATIONS_URL: z.url(),
  /** Base URL of the documents service, which issues the Form M PDF and the receipt. */
  DOCUMENTS_URL: z.url(),
  /** Base URL of the integration-gateway, whose ICMS adapter registers EACC's referrals. */
  INTEGRATION_GATEWAY_URL: z.url(),
  /** Base URL of the ai-gateway, whose `narrate-compliance-report` task drafts the NCR narrative. */
  AI_GATEWAY_URL: z.url(),
  /**
   * Pushing a referral to ICMS: how many times the gateway is tried while ICMS is unreachable,
   * and the pause before the second try (doubling for each later one), before the push is left
   * `push-failed` for EACC to push again.
   */
  ICMS_PUSH_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  ICMS_PUSH_BACKOFF_MS: z.coerce.number().int().min(0).default(500),
  /**
   * When the yearly compile runs (cron, Nairobi time): each Commission's draft for the financial
   * year that just ended, on 1 July. `off` keeps no schedule (tests).
   */
  ANNUAL_COMPILE_CRON: z.string().min(1).default('0 6 1 7 *'),
  /**
   * When EACC's chase of Commissions that have not reported starts (cron, Nairobi time): the
   * `NationalConsolidationWorkflow` of the financial year whose reports were due on 31 July, on
   * 1 August; it chases weekly from then. `off` keeps no schedule (tests).
   */
  NATIONAL_CHASE_CRON: z.string().min(1).default('0 6 1 8 *'),
  /**
   * EACC intake outliers: a Commission whose declared rate (declared / expected) in a section is
   * below its threshold is flagged `low-<section>-rate`. Fractions from 0 to 1.
   */
  INTAKE_MIN_INITIAL_RATE: z.coerce.number().min(0).max(1).default(0.8),
  INTAKE_MIN_BIENNIAL_RATE: z.coerce.number().min(0).max(1).default(0.8),
  INTAKE_MIN_FINAL_RATE: z.coerce.number().min(0).max(1).default(0.8),
  /**
   * NCR pattern candidates (spec 09b): what makes a pattern notable. Rates and points are
   * fractions (0.02 is 2 points). A difference of rates under `CANDIDATE_MIN_POINTS` is never a
   * pattern. `rate-change`: a non-filer rate that moved by at least `CANDIDATE_RATE_CHANGE_FACTOR`
   * (2: doubled or halved) from the year before. `threshold-breach`: a non-filer rate above
   * `CANDIDATE_MAX_NON_FILER_RATE`. `chronic-late-reporting`: a report late in each of the last
   * `CANDIDATE_CHRONIC_LATE_YEARS` years. `clarification-ratio-outlier`: clarifications per
   * declaration filed at least `CANDIDATE_CLARIFICATION_RATIO_FACTOR` times the national ratio.
   * `size-band-outlier`: a non-filer rate at least `CANDIDATE_SIZE_BAND_FACTOR` times that of the
   * other Commissions of its size band; `CANDIDATE_SIZE_BANDS` lists the officers expected at
   * which each band above the smallest starts (`100,1000`: under 100, 100 to 999, 1000 and over).
   */
  CANDIDATE_MIN_POINTS: z.coerce.number().min(0).max(1).default(0.02),
  CANDIDATE_RATE_CHANGE_FACTOR: z.coerce.number().min(1).default(2),
  CANDIDATE_MAX_NON_FILER_RATE: z.coerce.number().min(0).max(1).default(0.1),
  CANDIDATE_CHRONIC_LATE_YEARS: z.coerce.number().int().min(2).max(10).default(3),
  CANDIDATE_CLARIFICATION_RATIO_FACTOR: z.coerce.number().min(1).default(2),
  CANDIDATE_SIZE_BANDS: z
    .string()
    .default('100,1000')
    .transform((value, context) => {
      const bands = value
        .split(',')
        .map((each) => each.trim())
        .filter((each) => each !== '')
        .map(Number);
      const ascending = bands.every((band, at) => at === 0 || band > (bands[at - 1] ?? 0));
      if (!bands.every((band) => Number.isInteger(band) && band > 0) || !ascending) {
        context.addIssue({
          code: 'custom',
          message: 'Comma-separated positive whole numbers, ascending',
        });
        return z.NEVER;
      }
      return bands;
    }),
  CANDIDATE_SIZE_BAND_FACTOR: z.coerce.number().min(1).default(2),
  /**
   * S3-compatible object storage (ADR-002) and the bucket of the open-data releases' dataset
   * files (JSON and CSV per table, the release JSON).
   */
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_OPEN_DATA: z.string().min(1).default('open-data'),
  /**
   * Valkey, where the public open-data API counts each client IP's requests, so the budget holds
   * across replicas and restarts. While it is down the API answers unlimited.
   */
  VALKEY_URL: z.url(),
  /**
   * Rate limits as `<group>=<limit>/<seconds>s` entries: `open-data`, requests to the public
   * open-data API per client IP.
   */
  RATE_LIMITS: rateLimitsSchema
    .prefault(`${OPEN_DATA_RATE_LIMIT}=60/60s`)
    .refine((groups) => OPEN_DATA_RATE_LIMIT in groups, {
      message: `Configure the group ${OPEN_DATA_RATE_LIMIT}`,
    }),
  /**
   * Origin of the public verify app: a public release links its manifest's verify page,
   * `<origin>/v/<code>`, as documents prints it on the manifest's QR code.
   */
  VERIFY_BASE_URL: z.url(),
  /** Confidential Keycloak client whose service account calls other services' internal APIs. */
  KEYCLOAK_CLIENT_ID: z.string().min(1).default('reporting'),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
  /** OpenBao Transit, which wraps the data keys of the encrypted report snapshots (ADR-006). */
  OPENBAO_ADDR: z.url(),
  OPENBAO_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
