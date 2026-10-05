import { baseEnvSchema, loadConfig } from '@adili/api-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'audit';
export const SERVICE_DESCRIPTION =
  'Tamper-evident, hash-chained audit trail with signed anchors and audit queries.';

export const envSchema = baseEnvSchema.extend({
  DATABASE_URL: z.url(),
  RABBITMQ_URL: z.url(),
  TEMPORAL_ADDRESS: z.string().min(1),
  TEMPORAL_NAMESPACE: z.string().min(1),
  /** The queue the audit worker polls: the daily anchoring runs here (ADR-013 §4). */
  TEMPORAL_TASK_QUEUE: z.string().min(1).default('audit'),
  /**
   * When the day's chains are anchored (cron, Nairobi time): every tenant's chain of each UTC day
   * that has ended and has no anchor yet gets its signed Merkle root (ADR-008 Pipeline step 5),
   * and the chains anchored are verified again (step 6). `off` keeps no schedule (tests).
   */
  AUDIT_ANCHOR_CRON: z.string().min(1).default('30 3 * * *'),
  /** OpenBao Transit, whose Ed25519 key signs the anchors; the key never leaves OpenBao. */
  OPENBAO_ADDR: z.url(),
  OPENBAO_TOKEN: z.string().min(1),
  /** The Transit key that signs anchors; created on first use. */
  AUDIT_ANCHOR_KEY: z.string().min(1).default('audit-anchor'),
  /** S3-compatible object storage (ADR-002) and the bucket the anchors are archived in. */
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET_AUDIT_ARCHIVE: z.string().min(1).default('audit-archive'),
});

export type Env = z.infer<typeof envSchema>;

export const config: Env = loadConfig(envSchema);
