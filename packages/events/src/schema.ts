import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import type { EventEnvelope } from './envelope.js';

/**
 * Transactional outbox (ADR-005): events are written in the same transaction as the state
 * change, then relayed to RabbitMQ. Every service that publishes includes this table.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid().primaryKey(),
    eventType: text().notNull(),
    envelope: jsonb().$type<EventEnvelope>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    lastError: text(),
  },
  (table) => [
    index('outbox_unpublished_idx')
      .on(table.id)
      .where(sql`${table.publishedAt} is null`),
  ],
);

/** Inbox for idempotent consumers: one row per (consumer, event) already processed. */
export const inbox = pgTable(
  'inbox',
  {
    consumer: text().notNull(),
    eventId: uuid().notNull(),
    processedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.consumer, table.eventId] })],
);

export const eventsSchema = { outbox, inbox };
