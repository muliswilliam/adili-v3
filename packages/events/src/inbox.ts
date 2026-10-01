import type { Database } from '@adili/data-access';
import { and, eq } from 'drizzle-orm';

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

/**
 * Runs `work` unless (consumer, event) was consumed already, and records the event only after
 * `work` succeeded, outside any transaction. For work that is idempotent on its own and calls
 * other services, which must not hold a transaction open (ADR-013). A redelivery while the first
 * run is still working, or after it failed, does the work again. Returns false when skipped.
 */
export async function consumeIdempotent<TSchema extends Record<string, unknown>>(
  db: Database<TSchema>,
  consumer: string,
  event: Pick<EventEnvelope, 'id'>,
  work: () => Promise<void>,
): Promise<boolean> {
  const [found] = await db
    .select({ eventId: inbox.eventId })
    .from(inbox)
    .where(and(eq(inbox.consumer, consumer), eq(inbox.eventId, event.id)))
    .limit(1);
  if (found) return false;
  await work();
  await db.insert(inbox).values({ consumer, eventId: event.id }).onConflictDoNothing();
  return true;
}
