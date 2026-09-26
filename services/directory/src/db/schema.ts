import { idempotencySchema } from '@adili/api-kit/schema';
import { eventsSchema } from '@adili/events/schema';

/** Drizzle schema of the directory database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...idempotencySchema,
};

export * from '@adili/api-kit/schema';
export * from '@adili/events/schema';
