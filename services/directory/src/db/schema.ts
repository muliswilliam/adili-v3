import { idempotencySchema } from '@adili/api-kit/schema';
import { eventsSchema } from '@adili/events/schema';

import { commissionsSchema } from '../commissions/schema.js';
import { apiCredentialSchema } from '../roster/api-credential/schema.js';
import { rosterSchema } from '../roster/schema.js';

/** Drizzle schema of the directory database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...idempotencySchema,
  ...commissionsSchema,
  ...apiCredentialSchema,
  ...rosterSchema,
};

export type DirectorySchema = typeof schema;

export * from '../commissions/schema.js';
export * from '../roster/api-credential/schema.js';
export * from '../roster/schema.js';
export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
