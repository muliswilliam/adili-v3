import { eventsSchema } from '@adili/events/schema';

/** Drizzle schema of the integration-gateway database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
};

export * from '@adili/events/schema';
