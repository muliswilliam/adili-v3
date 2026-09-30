import { idempotencySchema } from '@adili/api-kit/schema';
import { eventsSchema } from '@adili/events/schema';
import { numberingSchema } from '@adili/numbering/schema';

import { draftsSchema } from '../drafts/schema.js';
import { obligationsSchema } from '../obligations/schema.js';
import { submissionSchema } from '../submission/schema.js';

/** Drizzle schema of the declarations database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...idempotencySchema,
  ...numberingSchema,
  ...obligationsSchema,
  ...draftsSchema,
  ...submissionSchema,
};

export type DeclarationsSchema = typeof schema;

export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
export * from '@adili/numbering/schema';
export * from '../drafts/schema.js';
export * from '../obligations/schema.js';
export * from '../submission/schema.js';
