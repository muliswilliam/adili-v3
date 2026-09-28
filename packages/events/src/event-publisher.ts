import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@adili/data-access';

import { createEnvelope, type EventEnvelope, type NewEvent } from './envelope.js';
import { outbox } from './schema.js';

export interface EventsModuleOptions {
  service: string;
  rabbitmqUrl: string;
}

export const EVENTS_OPTIONS = Symbol('EVENTS_OPTIONS');

/** Any Drizzle handle that can insert into the outbox: the database or an open transaction. */
type Executor = Pick<Database, 'insert'>;

/** Records events in the outbox, inside the caller's transaction. */
@Injectable()
export class EventPublisher {
  constructor(@Inject(EVENTS_OPTIONS) private readonly options: EventsModuleOptions) {}

  async record<TData extends Record<string, unknown>>(
    tx: Executor,
    event: NewEvent<TData>,
  ): Promise<EventEnvelope<TData>> {
    const envelope = createEnvelope(`adili/${this.options.service}`, event);
    await tx.insert(outbox).values({ id: envelope.id, eventType: envelope.type, envelope });
    return envelope;
  }

  /**
   * Records `events` in the outbox in order, in multi-row inserts: for work that emits many
   * events at once (one per obligation of a roster page).
   */
  async recordAll<TData extends Record<string, unknown>>(
    tx: Executor,
    events: readonly NewEvent<TData>[],
  ): Promise<EventEnvelope<TData>[]> {
    const envelopes = events.map((event) => createEnvelope(`adili/${this.options.service}`, event));
    for (let start = 0; start < envelopes.length; start += RECORD_ALL_CHUNK) {
      await tx
        .insert(outbox)
        .values(
          envelopes
            .slice(start, start + RECORD_ALL_CHUNK)
            .map((envelope) => ({ id: envelope.id, eventType: envelope.type, envelope })),
        );
    }
    return envelopes;
  }
}

/** Rows per insert: three parameters each, well under Postgres' 65,535 per statement. */
const RECORD_ALL_CHUNK = 1_000;
