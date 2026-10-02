import { idempotencySchema } from '@adili/api-kit/schema';
import { eventsSchema } from '@adili/events/schema';
import { numberingSchema } from '@adili/numbering/schema';

import { declarationSchema } from '../declaration/schema.js';
import { draftsSchema } from '../drafts/schema.js';
import { helpSchema } from '../help/schema.js';
import { obligationsSchema } from '../obligations/schema.js';
import { suggestionsSchema } from '../suggestions/schema.js';

/** Drizzle schema of the declarations database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...idempotencySchema,
  ...numberingSchema,
  ...obligationsSchema,
  ...declarationSchema,
  ...draftsSchema,
  ...helpSchema,
  ...suggestionsSchema,
};

export type DeclarationsSchema = typeof schema;

export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
export * from '@adili/numbering/schema';
export * from '../declaration/schema.js';
export * from '../drafts/schema.js';
export * from '../help/schema.js';
export * from '../obligations/schema.js';
export * from '../suggestions/schema.js';
