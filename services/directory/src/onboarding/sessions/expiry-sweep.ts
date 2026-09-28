import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, asc, lte, notInArray } from 'drizzle-orm';

import { Clock } from '../../clock.js';
import { PLATFORM_TENANT } from '../../commissions/access.js';
import type { DirectorySchema } from '../../db/schema.js';
import { onboardingSessions } from '../schema.js';
import { TERMINAL_STATES } from '../session-state.js';
import { OnboardingSessions } from '../sessions.repository.js';

const BATCH_SIZE = 500;

/**
 * Ends live sessions past their expiry (`expired`, event outcome `expired`), so the audit trail
 * shows abandoned sessions end without a request touching them (spec 03). Run every minute by
 * the `onboarding-session-expiry` Temporal schedule (`expiry-schedule.ts`, ADR-003), once for the
 * whole service, not per replica. Requests on an expired session end it themselves, so the sweep
 * is never needed for correctness; sessions a request holds are skipped until the next run.
 */
@Injectable()
export class OnboardingSessionSweeper {
  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly sessions: OnboardingSessions,
    private readonly clock: Clock,
  ) {}

  /** Ends every live session past its expiry at the clock's time; returns how many. */
  async sweep(): Promise<number> {
    let ended = 0;
    for (;;) {
      const now = this.clock.now();
      const count = await withTenant(
        this.db,
        { tenant: PLATFORM_TENANT, subject: 'onboarding-sweep' },
        async (tx) => {
          const expired = await tx
            .select()
            .from(onboardingSessions)
            .where(
              and(
                notInArray(onboardingSessions.state, [...TERMINAL_STATES]),
                lte(onboardingSessions.expiresAt, now),
              ),
            )
            .orderBy(asc(onboardingSessions.expiresAt))
            .limit(BATCH_SIZE)
            .for('update', { skipLocked: true });
          for (const session of expired) {
            await this.sessions.end(tx, session, 'expired', now);
          }
          return expired.length;
        },
      );
      ended += count;
      if (count < BATCH_SIZE) return ended;
    }
  }
}
