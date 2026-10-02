import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { lte, sql } from 'drizzle-orm';

import type { ReviewSchema } from '../db/schema.js';
import { SYSTEM_SUBJECT } from '../system-context.js';
import { reviewCopilotDrafts } from './draft-schema.js';

/** How often expired drafts are deleted. Reads never serve one past its day meanwhile. */
export const DRAFT_PURGE_INTERVAL_MS = 15 * 60_000;

/**
 * Deletes clarification drafts past their 24 hours (spec 07c S12), every quarter hour, on every
 * replica: the delete is idempotent, and a draft past its day already reads as gone.
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

  /** Deletes every Commission's expired drafts; how many. */
  async purge(): Promise<number> {
    const deleted = await withTenant(
      this.db,
      { tenant: 'platform', subject: SYSTEM_SUBJECT },
      (tx) =>
        tx
          .delete(reviewCopilotDrafts)
          .where(lte(reviewCopilotDrafts.expiresAt, sql`now()`))
          .returning({ id: reviewCopilotDrafts.id }),
    );
    return deleted.length;
  }
}
