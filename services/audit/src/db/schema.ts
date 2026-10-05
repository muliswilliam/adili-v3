import { eventsSchema } from '@adili/events/schema';

import { trailSchema } from '../trail/schema.js';

/** Drizzle schema of the audit database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...trailSchema,
};

export type AuditSchema = typeof schema;

export * from '../trail/schema.js';
export * from '@adili/events/schema';
