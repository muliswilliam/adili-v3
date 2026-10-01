import { idempotencySchema } from '@adili/api-kit/schema';
import { eventsSchema } from '@adili/events/schema';

import { issuanceSchema } from '../issuance/schema.js';
import { uploadsSchema } from '../uploads/schema.js';

/** Drizzle schema of the documents database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...idempotencySchema,
  ...uploadsSchema,
  ...issuanceSchema,
};

export type DocumentsSchema = typeof schema;

export * from '../issuance/schema.js';
export * from '../uploads/schema.js';
export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
