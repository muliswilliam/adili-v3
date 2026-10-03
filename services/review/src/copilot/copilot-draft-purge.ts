import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, isNull, lte, sql } from 'drizzle-orm';

import type { ReviewSchema } from '../db/schema.js';
import { SYSTEM_SUBJECT } from '../system-context.js';
import { reviewCopilotDrafts } from './draft-schema.js';

/** How often expired drafts' text is purged. Reads never serve one past its day meanwhile. */
export const DRAFT_PURGE_INTERVAL_MS = 15 * 60_000;

/**
 * Purges the drafted text of clarification drafts past their 24 hours (spec 07c S12), every
 * quarter hour, on every replica: the purge is idempotent, and a draft past its day already reads
 * as gone. The draft's row stays without its text: which job drafted on the case, for whom, so a
 * clarification saved later still names its AI-drafted items (ADR-007).
 */
@Injectable()
export class CopilotDraftPurge implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CopilotDraftPurge.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(@InjectDatabase() private readonly db: Database<ReviewSchema>) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.purge().catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Could not purge expired copilot drafts');
      });
    }, DRAFT_PURGE_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** Purges the text of every Commission's expired drafts; how many. */
  async purge(): Promise<number> {
    const purged = await withTenant(
      this.db,
      { tenant: 'platform', subject: SYSTEM_SUBJECT },
      (tx) =>
        tx
          .update(reviewCopilotDrafts)
          .set({ ciphertext: null, envelope: null, purgedAt: sql`now()` })
          .where(
            and(
              lte(reviewCopilotDrafts.expiresAt, sql`now()`),
              isNull(reviewCopilotDrafts.purgedAt),
            ),
          )
          .returning({ id: reviewCopilotDrafts.id }),
    );
    return purged.length;
  }
}
