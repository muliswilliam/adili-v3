import { idempotencySchema } from '@adili/api-kit/schema';
import { eventsSchema } from '@adili/events/schema';
import { numberingSchema } from '@adili/numbering/schema';

import { complianceReportsSchema } from '../compliance-reports/schema.js';
import { projectionsSchema } from '../projections/schema.js';

/** Drizzle schema of the reporting database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  // Facts built from other services' events, per Commission and financial year.
  ...projectionsSchema,
  // Form M: one report per Commission per financial year.
  ...complianceReportsSchema,
  // `RPT` reference counters (ADR-011), allocated in the transaction that submits a report.
  ...numberingSchema,
  // Stored outcomes of `Idempotency-Key` writes (confirming and submitting a report).
  ...idempotencySchema,
};

export type ReportingSchema = typeof schema;

export * from '../compliance-reports/schema.js';
export * from '../projections/schema.js';
export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
export * from '@adili/numbering/schema';
