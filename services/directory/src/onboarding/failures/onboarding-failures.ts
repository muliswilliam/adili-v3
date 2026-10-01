import { Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, asc, eq, gte, sql } from 'drizzle-orm';

import { Clock } from '../../clock.js';
import { canSeeCommission, tenantContextOf } from '../../commissions/access.js';
import type { Transaction } from '../../commissions/commissions.service.js';
import { commissions } from '../../commissions/schema.js';
import { config } from '../../config.js';
import type { DirectorySchema } from '../../db/schema.js';
import { onboardingAbuseThreshold } from '../events.js';
import { onboardingFailures } from '../schema.js';
import type { OnboardingFailuresView } from './representation.js';

const WINDOW_MS = 60 * 60 * 1000;
/** The hours a reporting officer's count covers: this one and the 23 before it. */
export const RECENT_FAILURE_HOURS = 24;

/** The start of the hour `now` falls in: the counter's window. */
export function failureWindow(now: Date): Date {
  return new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
}

/**
 * Failed onboarding attempts per Commission and hour (`onboarding_failures`), whoever made them
 * (spec 03, abuse controls; story 30): identify answered `no-match`, or a session ended because
 * its codes or resends ran out. When a window's count reaches `ONBOARDING_ABUSE_THRESHOLD` it
 * logs a warning and records `onboarding.abuse-threshold.v1`, once per window. The Commission's
 * staff read the last 24 hours (`recent`).
 */
@Injectable()
export class OnboardingFailures {
  private readonly logger = new Logger(OnboardingFailures.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /** Counts one failure against `tenant` in the caller's transaction (scoped to `tenant`). */
  async record(tx: Transaction, tenant: string, now: Date): Promise<number> {
    const windowStart = failureWindow(now);
    const [row] = await tx
      .insert(onboardingFailures)
      .values({ tenant, windowStart, failures: 1 })
      .onConflictDoUpdate({
        target: [onboardingFailures.tenant, onboardingFailures.windowStart],
        set: { failures: sql`${onboardingFailures.failures} + 1` },
      })
      .returning({ failures: onboardingFailures.failures });
    const failures = row?.failures ?? 1;
    if (failures === config.ONBOARDING_ABUSE_THRESHOLD) {
      const window = windowStart.toISOString();
      this.logger.warn(
        { tenant, window, failures },
        'Failed onboarding attempts reached the abuse threshold',
      );
      await this.events.record(tx, onboardingAbuseThreshold(tenant, { window, failures }));
    }
    return failures;
  }

  /**
   * The Commission `slug`'s failed attempts in the last 24 hours, by hour, for those who may see
   * the Commission (404 for anyone else, as if it did not exist).
   */
  async recent(principal: Principal, slug: string): Promise<OnboardingFailuresView> {
    notFoundIfInvisible(slug, () => canSeeCommission(principal, slug));
    const since = new Date(
      failureWindow(this.clock.now()).getTime() - (RECENT_FAILURE_HOURS - 1) * WINDOW_MS,
    );
    return withTenant(this.db, tenantContextOf(principal), async (tx) => {
      const [commission] = await tx
        .select({ slug: commissions.slug })
        .from(commissions)
        .where(eq(commissions.slug, slug));
      notFoundIfInvisible(commission);
      const hours = await tx
        .select({
          windowStart: onboardingFailures.windowStart,
          failedAttempts: onboardingFailures.failures,
        })
        .from(onboardingFailures)
        .where(and(eq(onboardingFailures.tenant, slug), gte(onboardingFailures.windowStart, since)))
        .orderBy(asc(onboardingFailures.windowStart));
      return {
        since: since.toISOString(),
        failedAttempts: hours.reduce((sum, hour) => sum + hour.failedAttempts, 0),
        hours: hours.map((hour) => ({
          windowStart: hour.windowStart.toISOString(),
          failedAttempts: hour.failedAttempts,
        })),
      };
    });
  }
}
