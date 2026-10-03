import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, eq, isNotNull, lte } from 'drizzle-orm';

import { Clock } from '../clock.js';
import { PLATFORM_CONTEXT } from '../obligations/system-context.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import { assistantConversations } from './schema.js';

/**
 * Ask Adili's conversations go with the draft (spec 11 S7): in the transaction that discards the
 * draft, submits it (an amendment's resubmit included) or discards an amendment, the
 * declaration row locked, its conversation is deleted; its messages cascade.
 */
export async function deleteConversations(tx: Transaction, declarationId: string): Promise<void> {
  await tx
    .delete(assistantConversations)
    .where(eq(assistantConversations.declarationId, declarationId));
}

/** How often expired conversations are deleted. Reads never serve one past its expiry meanwhile. */
export const EXPIRY_SWEEP_INTERVAL_MS = 15 * 60_000;

/**
 * Deletes the conversations outside a draft 30 days after their last message (spec 11 S7), every
 * quarter hour, on every replica: the delete is idempotent, and an expired conversation already
 * reads as gone. Runs as the platform, which row-level security lets delete only conversations
 * with an expiry (migration 0023); their messages cascade.
 */
@Injectable()
export class ConversationExpiry implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ConversationExpiry.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Could not delete expired assistant conversations');
      });
    }, EXPIRY_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** Deletes every expired conversation; how many. */
  async sweep(): Promise<number> {
    const deleted = await withTenant(this.db, PLATFORM_CONTEXT, (tx) =>
      tx
        .delete(assistantConversations)
        .where(
          and(
            isNotNull(assistantConversations.expiresAt),
            lte(assistantConversations.expiresAt, this.clock.now()),
          ),
        )
        .returning({ id: assistantConversations.id }),
    );
    return deleted.length;
  }
}
