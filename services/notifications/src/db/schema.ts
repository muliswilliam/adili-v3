import { idempotencySchema } from '@adili/api-kit/schema';
import { eventsSchema } from '@adili/events/schema';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
    /**
     * Keyed hash of the address the message went to; null when a person recipient had no
     * contact for the channel.
     */
    recipientHash: text(),
    /** The person the caller addressed, when it named a person rather than an address. */
    recipientPersonId: uuid(),
    /** Responsible Commission the message was sent for, when the caller named one. */
    tenant: text(),
    /** OAuth client of the calling service (`azp`, else `sub`); only it can read the message. */
    caller: text().notNull(),
    status: text({ enum: ['sent', 'failed'] }).notNull(),
    providerMessageId: text(),
    /** Failure reason code, e.g. `timeout`, `rejected-recipient` or `no-contact`. */
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // Support looks up what was sent to a person by hashing their address with the same key.
  (table) => [
    index('messages_recipient_idx').on(table.recipientHash, table.createdAt),
    index('messages_recipient_person_idx').on(table.recipientPersonId, table.createdAt),
    // Every message names whom it was for: an address, a person, or both.
    check(
      'messages_recipient_check',
      sql`${table.recipientHash} is not null or ${table.recipientPersonId} is not null`,
    ),
  ],
);

/** Drizzle schema of the notifications database. Only this service reads or writes it (ADR-013). */
export const schema = {
  ...eventsSchema,
  ...idempotencySchema,
  messages,
};

export * from '@adili/events/schema';
export * from '@adili/api-kit/schema';
