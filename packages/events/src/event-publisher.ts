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
}
