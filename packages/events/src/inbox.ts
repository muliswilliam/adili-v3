import type { Database } from '@adili/data-access';

import type { EventEnvelope } from './envelope.js';
import { inbox } from './schema.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Runs `work` at most once per (consumer, event), in one transaction with the inbox record,
 * so redelivered events are skipped. Returns false when the event was already processed.
 */
export async function consumeOnce(
  db: Database,
  consumer: string,
  event: Pick<EventEnvelope, 'id'>,
  work: (tx: Transaction) => Promise<void>,
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
