import { eventsSchema } from '@adili/events/schema';

import { verificationSchema } from '../verification/schema.js';

/** Drizzle schema of the verification-api database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...verificationSchema,
};

export type VerificationSchema = typeof schema;

export * from '../verification/schema.js';
export * from '@adili/events/schema';
