import { idempotencySchema } from '@adili/api-kit/schema';
import { eventsSchema } from '@adili/events/schema';
import { numberingSchema } from '@adili/numbering/schema';

import { approvalsSchema } from '../approvals/schema.js';
import { casesSchema } from '../cases/schema.js';
import { determinationsSchema } from '../determinations/schema.js';

/** Drizzle schema of the review database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...casesSchema,
  ...determinationsSchema,
  ...approvalsSchema,
  // `CLR` and `CMP` reference counters (ADR-011), allocated in the transaction of the legal act.
  ...numberingSchema,
  // Stored outcomes of `Idempotency-Key` writes (issuing a clarification, approving a determination).
  ...idempotencySchema,
};

export type ReviewSchema = typeof schema;

export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
export * from '@adili/numbering/schema';
export * from '../approvals/schema.js';
export * from '../cases/schema.js';
export * from '../determinations/schema.js';
