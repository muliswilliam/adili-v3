import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { consumeOnce, type EventEnvelope } from '@adili/events';
import { and, eq, sql } from 'drizzle-orm';

import type { AuditSchema } from '../db/schema.js';
import { chainDayOf, eventHash, GENESIS_HASH, HASH_V } from './chain.js';
import { recordOf } from './record.js';
import { auditChainHeads, auditEvents } from './schema.js';

/** The inbox consumer name the trail deduplicates deliveries under. */
export const TRAIL_CONSUMER = 'audit.trail';

/**
 * Appends events to the trail (ADR-008 Pipeline steps 3 and 4): once per event id (the inbox,
 * and a unique index behind it), at the end of its tenant's chain of the day it is recorded on.
 * The chain is that of the recording day, not the day the event occurred: an event the relay
 * delivers late joins today's chain, so a day's chain is complete, and can be anchored, once the
 * day has ended.
 */
@Injectable()
export class AuditTrail {
  constructor(@InjectDatabase() private readonly db: Database<AuditSchema>) {}

  /** Appends `envelope`; false when it was in the trail already. */
  async append(envelope: EventEnvelope, recordedAt: Date = new Date()): Promise<boolean> {
    const record = recordOf(envelope);
    const chainDay = chainDayOf(recordedAt);
    return consumeOnce(this.db, TRAIL_CONSUMER, envelope, async (tx) => {
      // The head row is the chain's lock: appends to one chain wait for each other.
      await tx
        .insert(auditChainHeads)
        .values({ tenant: record.tenant, chainDay, seq: 0, headHash: GENESIS_HASH })
        .onConflictDoNothing();
      const [head] = await tx
        .select({ seq: auditChainHeads.seq, headHash: auditChainHeads.headHash })
        .from(auditChainHeads)
        .where(
          and(eq(auditChainHeads.tenant, record.tenant), eq(auditChainHeads.chainDay, chainDay)),
        )
        .for('update');
      if (!head) throw new Error(`No chain head for ${record.tenant} ${chainDay}`);
      const seq = head.seq + 1;
      const hash = eventHash(head.headHash, { tenant: record.tenant, chainDay, seq }, envelope);
      await tx.insert(auditEvents).values({
        ...record,
        chainDay,
        seq,
        eventId: envelope.id,
        eventType: envelope.type,
        source: envelope.source,
        occurredAt: new Date(envelope.time),
        recordedAt,
        envelope,
        hashV: HASH_V,
        prevHash: head.headHash,
        hash,
      });
      await tx
        .update(auditChainHeads)
        .set({ seq, headHash: hash, updatedAt: sql`now()` })
        .where(
          and(eq(auditChainHeads.tenant, record.tenant), eq(auditChainHeads.chainDay, chainDay)),
        );
    });
  }
}
