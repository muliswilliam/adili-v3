import type { Database } from '@adili/data-access';

import type { EventEnvelope } from './envelope.js';
import { inbox } from './schema.js';

type Transaction<TSchema extends Record<string, unknown>> = Parameters<
  Parameters<Database<TSchema>['transaction']>[0]
>[0];

/**
 * Runs `work` at most once per (consumer, event), in one transaction with the inbox record,
 * so redelivered events are skipped. Returns false when the event was already processed.
 */
export async function consumeOnce<TSchema extends Record<string, unknown>>(
  db: Database<TSchema>,
  consumer: string,
  event: Pick<EventEnvelope, 'id'>,
  work: (tx: Transaction<TSchema>) => Promise<void>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(inbox)
      .values({ consumer, eventId: event.id })
      .onConflictDoNothing()
      .returning({ eventId: inbox.eventId });
    if (inserted.length === 0) {
      return false;
    }
    await work(tx);
    return true;
  });
}
