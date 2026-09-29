import { eventsSchema } from '@adili/events/schema';

import { casesSchema } from '../cases/schema.js';

/** Drizzle schema of the review database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...casesSchema,
};

export type ReviewSchema = typeof schema;

export * from '@adili/events/schema';
export * from '../cases/schema.js';
