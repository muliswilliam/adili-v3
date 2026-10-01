import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { type Database, InjectDatabase } from '@adili/data-access';
import { consumeOnce, type EventEnvelope, OnEvent } from '@adili/events';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { TENANT_KEY } from '@adili/api-kit';
import type { ReviewTransaction } from '../cases/case-lookup.js';
import { SYSTEM_SUBJECT } from '../system-context.js';
import { referrals } from './schema.js';

/**
 * `referral.icms-registered.v1` (spec 09, reporting): EACC pushed a sent referral to ICMS and ICMS
 * registered it under a case number. The tenant extension is the Commission that sent it.
 */
export const REFERRAL_ICMS_REGISTERED = 'referral.icms-registered.v1';

/** The inbox consumer name of `referral.icms-registered.v1`. */
export const REFERRAL_ICMS_REGISTERED_CONSUMER = 'review.referral-icms-registered';

/** What the consumer reads from `referral.icms-registered.v1`. */
const icmsRegistered = z.object({
  referralId: z.uuid(),
  icmsCaseNumber: z.string().trim().min(1).max(200),
  registeredAt: z.iso.datetime({ offset: true }),
});

const tenantSchema = z.string().regex(TENANT_KEY);

/**
 * Records ICMS's case number on the Commission's referral (spec 09 BE-11), so its reviewers and
 * supervisors see "ICMS case {number}" and can follow up. Each event is handled once (inbox), and
 * a referral keeps the first case number it was given: reporting publishes one per referral, and
 * a later one never overwrites it. The referral is looked up under the Commission's row-level
 * security, so an event naming another Commission's referral changes nothing. Nothing is
 * published: the event is reporting's record of the registration.
 */
@Controller()
export class ReferralIcmsRegisteredConsumer {
  constructor(@InjectDatabase() private readonly db: Database) {}

  @OnEvent(REFERRAL_ICMS_REGISTERED)
  async registered(@Payload() event: EventEnvelope): Promise<void> {
    const { referralId, icmsCaseNumber, registeredAt } = icmsRegistered.parse(event.data);
    const tenant = tenantSchema.parse(event.tenant);
    await consumeOnce(this.db, REFERRAL_ICMS_REGISTERED_CONSUMER, event, async (inboxTx) => {
      // The inbox's transaction is the review database's: typed with its schema for the referral.
      const tx = inboxTx as unknown as ReviewTransaction;
      await tx.execute(
        sql`select set_config('app.tenant', ${tenant}, true), set_config('app.subject', ${SYSTEM_SUBJECT}, true)`,
      );
      await tx
        .update(referrals)
        .set({ icmsCaseNumber, icmsRegisteredAt: new Date(registeredAt) })
        .where(
          and(
            eq(referrals.id, referralId),
            eq(referrals.tenant, tenant),
            eq(referrals.status, 'sent'),
            isNull(referrals.icmsCaseNumber),
          ),
        );
    });
  }
}
