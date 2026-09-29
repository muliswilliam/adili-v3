import { eventsSchema } from '@adili/events/schema';

import { draftsSchema } from '../drafts/schema.js';
import { helpSchema } from '../help/schema.js';
import { obligationsSchema } from '../obligations/schema.js';

/** Drizzle schema of the declarations database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...obligationsSchema,
  ...draftsSchema,
  ...helpSchema,
};

export type DeclarationsSchema = typeof schema;

export * from '@adili/events/schema';
export * from '../drafts/schema.js';
export * from '../help/schema.js';
export * from '../obligations/schema.js';
