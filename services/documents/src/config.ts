import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'documents';
/** The subject of the service's own work (events it handles, sweeps): `issuedBy` of its slips. */
export const SYSTEM_SUBJECT = `system:${SERVICE_NAME}`;
export const SERVICE_DESCRIPTION =
  'Uploads, malware scanning, PDF issuance, signing, QR codes and verification records.';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1),
  S3_ENDPOINT: z.url(),
  /**
   * Endpoint browsers reach the storage at, for presigned upload URLs; defaults to S3_ENDPOINT
   * (the same host in local development).
   */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_QUARANTINE: z.string().min(1),
  S3_BUCKET_CLEAN: z.string().min(1),
  S3_BUCKET_ISSUED: z.string().min(1),
  CLAMAV_HOST: z.string().min(1),
  CLAMAV_PORT: z.coerce.number().int().positive(),
  GOTENBERG_URL: z.url(),
  OPENBAO_ADDR: z.url(),
  OPENBAO_TOKEN: z.string().min(1),
  /**
   * Origin of the public verify app: QR codes on issued documents point at `<origin>/v/<code>`
   * (the demo's verify app on its own port, so a demo slip resolves on the demo machine).
   */
  VERIFY_BASE_URL: z.url(),
  /** The declarations service, whose internal API an acknowledgement slip's payload comes from. */
  DECLARATIONS_API_URL: z.url(),
  /** The review service, whose internal API a clarification letter's payload comes from. */
  REVIEW_API_URL: z.url(),
  /**
   * The service's confidential Keycloak client (client credentials, `declarations:internal` and
   * `review:internal`).
   */
  KEYCLOAK_CLIENT_ID: z.string().min(1).default('documents'),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
