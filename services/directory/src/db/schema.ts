import { idempotencySchema } from '@adili/api-kit/schema';
import { eventsSchema } from '@adili/events/schema';

import { commissionsSchema } from '../commissions/schema.js';
import { apiCredentialSchema } from '../roster/api-credential/schema.js';

/** Drizzle schema of the directory database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...idempotencySchema,
  ...commissionsSchema,
  ...apiCredentialSchema,
};

export type DirectorySchema = typeof schema;

export * from '../commissions/schema.js';
export * from '../roster/api-credential/schema.js';
export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
