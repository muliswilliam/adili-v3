import { Injectable, Logger } from '@nestjs/common';
import { EventPublisher } from '@adili/events';
import { sql } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import { config } from '../../config.js';
import { onboardingAbuseThreshold } from '../events.js';
import { onboardingAttempts } from '../schema.js';

const WINDOW_MS = 60 * 60 * 1000;

/** The start of the hour `now` falls in: the counter's window. */
export function failureWindow(now: Date): Date {
  return new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
}

/**
 * Counts failed identify attempts per Commission and hour (`onboarding_attempts`), whoever made
 * them, so a reporting officer and EACC can see a stale roster or an attack (spec 03, abuse
 * controls). When a window's count reaches `ONBOARDING_ABUSE_THRESHOLD` it logs a warning and
 * records `onboarding.abuse-threshold.v1`, once per window.
 */
@Injectable()
export class IdentifyFailureCounter {
  private readonly logger = new Logger(IdentifyFailureCounter.name);

  constructor(private readonly events: EventPublisher) {}

  /** Counts one failure against `tenant` in the caller's transaction (scoped to `tenant`). */
  async record(tx: Transaction, tenant: string, now: Date): Promise<number> {
    const windowStart = failureWindow(now);
    const [row] = await tx
      .insert(onboardingAttempts)
      .values({ tenant, windowStart, failures: 1 })
      .onConflictDoUpdate({
        target: [onboardingAttempts.tenant, onboardingAttempts.windowStart],
        set: { failures: sql`${onboardingAttempts.failures} + 1` },
      })
      .returning({ failures: onboardingAttempts.failures });
    const failures = row?.failures ?? 1;
    if (failures === config.ONBOARDING_ABUSE_THRESHOLD) {
      const window = windowStart.toISOString();
      this.logger.warn(
        { tenant, window, failures },
        'Failed onboarding identify attempts reached the abuse threshold',
      );
      await this.events.record(tx, onboardingAbuseThreshold(tenant, { window, failures }));
    }
    return failures;
  }
}
