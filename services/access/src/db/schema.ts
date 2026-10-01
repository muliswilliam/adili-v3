import { idempotencySchema } from '@adili/api-kit/schema';
import { eventsSchema } from '@adili/events/schema';
import { numberingSchema } from '@adili/numbering/schema';

import { agenciesSchema } from '../agencies/schema.js';
import { leaSchema } from '../lea/schema.js';
import { registerSchema } from '../register/schema.js';
import { requestsSchema } from '../requests/schema.js';
import { selfAccessSchema } from '../self-access/schema.js';

/** Drizzle schema of the access database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  // Form K access requests and the declarant's representations on them.
  ...requestsSchema,
  // Law enforcement requests, and the agencies their officers file for.
  ...leaSchema,
  ...agenciesSchema,
  // The append-only access register: every step of every request and self-access.
  ...registerSchema,
  // Certified copies and officer-recorded self-access applications.
  ...selfAccessSchema,
  // `ARQ` and `LEA` reference counters (ADR-011), allocated in the transaction that receives a
  // request.
  ...numberingSchema,
  // Stored outcomes of `Idempotency-Key` writes (submitting requests, decisions).
  ...idempotencySchema,
};

export type AccessSchema = typeof schema;

export * from '../agencies/schema.js';
export * from '../lea/schema.js';
export * from '../register/schema.js';
export * from '../requests/schema.js';
export * from '../self-access/schema.js';
export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
export * from '@adili/numbering/schema';
