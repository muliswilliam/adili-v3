import { eventsSchema } from '@adili/events/schema';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { CHANNELS, LOCALES } from '../messages/templates.js';

/**
 * One row per templated email or SMS handed to a provider. The recipient is kept only as a
 * keyed hash and the rendered content is never stored.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid().primaryKey(),
    channel: text({ enum: CHANNELS }).notNull(),
    template: text().notNull(),
    locale: text({ enum: LOCALES }).notNull(),
    recipientHash: text().notNull(),
    /** Responsible Commission the message was sent for, when the caller named one. */
    tenant: text(),
    /** OAuth client of the calling service (`azp`, else `sub`); only it can read the message. */
    caller: text().notNull(),
    status: text({ enum: ['sent', 'failed'] }).notNull(),
    providerMessageId: text(),
    /** Failure reason code, e.g. `timeout` or `rejected-recipient`. */
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // Support looks up what was sent to a person by hashing their address with the same key.
  (table) => [index('messages_recipient_idx').on(table.recipientHash, table.createdAt)],
);

/** Drizzle schema of the notifications database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  messages,
};

export * from '@adili/events/schema';
