import { idempotencySchema } from '@adili/api-kit/schema';
import { eventsSchema } from '@adili/events/schema';
import { numberingSchema } from '@adili/numbering/schema';

import { casesSchema } from '../cases/schema.js';

/** Drizzle schema of the review database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...casesSchema,
  // `CLR` reference counters (ADR-011), allocated in the transaction that issues a clarification.
  ...numberingSchema,
  // Stored outcomes of `Idempotency-Key` writes (issuing a clarification).
  ...idempotencySchema,
};

export type ReviewSchema = typeof schema;

export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
export * from '@adili/numbering/schema';
export * from '../cases/schema.js';
