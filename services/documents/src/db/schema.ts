import { eventsSchema } from '@adili/events/schema';

import { uploadsSchema } from '../uploads/schema.js';

/** Drizzle schema of the documents database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...uploadsSchema,
};

export type DocumentsSchema = typeof schema;

export * from '../uploads/schema.js';
export * from '@adili/events/schema';
