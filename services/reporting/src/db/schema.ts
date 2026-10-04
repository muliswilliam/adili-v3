import { idempotencySchema } from '@adili/api-kit/schema';
import { eventsSchema } from '@adili/events/schema';
import { numberingSchema } from '@adili/numbering/schema';

import { complianceReportsSchema } from '../compliance-reports/schema.js';
import { nationalReportsSchema } from '../national-reports/schema.js';
import { openDataSchema } from '../open-data/schema.js';
import { projectionsSchema } from '../projections/schema.js';
import { referralsSchema } from '../referrals/schema.js';

/** Drizzle schema of the reporting database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  // Facts built from other services' events, per Commission and financial year.
  ...projectionsSchema,
  // Form M: one report per Commission per financial year.
  ...complianceReportsSchema,
  // EACC's national consolidated report: one per financial year.
  ...nationalReportsSchema,
  // Open-data releases of the year's aggregates and their dataset files.
  ...openDataSchema,
  // EACC's referrals intake and their hand-off to ICMS.
  ...referralsSchema,
  // `RPT` and `NCR` reference counters (ADR-011), allocated in the transaction that submits a
  // report or approves the national consolidated report.
  ...numberingSchema,
  // Stored outcomes of `Idempotency-Key` writes (confirming and submitting a report, approving
  // the national consolidated report, pushing a referral to ICMS).
  ...idempotencySchema,
};

export type ReportingSchema = typeof schema;

export * from '../compliance-reports/schema.js';
export * from '../national-reports/schema.js';
export * from '../open-data/schema.js';
export * from '../projections/schema.js';
export * from '../referrals/schema.js';
export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
export * from '@adili/numbering/schema';
