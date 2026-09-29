import { eventsSchema } from '@adili/events/schema';

import { complianceReportsSchema } from '../compliance-reports/schema.js';
import { projectionsSchema } from '../projections/schema.js';

/** Drizzle schema of the reporting database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  // Facts built from other services' events, per Commission and financial year.
  ...projectionsSchema,
  // Form M: one report per Commission per financial year.
  ...complianceReportsSchema,
};

export type ReportingSchema = typeof schema;

export * from '../compliance-reports/schema.js';
export * from '../projections/schema.js';
export * from '@adili/events/schema';
