import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { eq } from 'drizzle-orm';

import { EACC_TENANT } from '../access.js';
import { Clock } from '../clock.js';
import type { ReportingTransaction } from '../compliance-reports/reports.js';
import type { ReportingSchema } from '../db/schema.js';
import { IntegrationGatewayClient } from '../integration-gateway/integration-gateway-client.js';
import { SYSTEM_SUBJECT } from '../system-context.js';
import type { IcmsCheckOutcome, IcmsRegistrationInput } from './contract.js';
import { recordPushFailed, recordRegistered, type ReferralIntakeRow } from './intake.js';
import { referralIntake } from './schema.js';

/**
 * The activities of `ReferralIcmsRegistrationWorkflow`, hosted by the reporting worker. Every
 * public method is an activity named after it (keep helpers out of this class); each is safe to
 * retry. An unreachable gateway propagates, so Temporal retries with backoff. The case number is
 * stored here and never returned into Temporal history.
 */
@Injectable()
export class ReferralIcmsActivities {
  constructor(
    @InjectDatabase() private readonly db: Database<ReportingSchema>,
    private readonly gateway: IntegrationGatewayClient,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * Asks the gateway where the referral's registration stands (`getIcmsReferral`): a case number
   * is stored (`registered`, `referral.icms-registered.v1`); a registration ICMS failed leaves the
   * referral `push-failed`. `superseded` once the referral is registered or pushed again.
   */
  async checkIcmsRegistration(input: IcmsRegistrationInput): Promise<IcmsCheckOutcome> {
    const row = await inEacc(this.db, async (tx) => {
      const [found] = await tx
        .select()
        .from(referralIntake)
        .where(eq(referralIntake.referralId, input.referralId));
      return found;
    });
    if (!waitingFor(row, input)) return 'superseded';
    const registration = await this.gateway.getReferral(row.tenant, row.reference);
    if (registration?.status === 'registered' && registration.caseNumber !== null) {
      const { caseNumber } = registration;
      const registeredAt = new Date(registration.registeredAt ?? this.clock.now());
      await inEacc(this.db, (tx) =>
        recordRegistered(tx, this.events, input.referralId, { caseNumber, registeredAt }),
      );
      return 'registered';
    }
    if (registration?.status === 'failed') {
      const failed = await inEacc(this.db, (tx) =>
        recordPushFailed(tx, this.events, input.referralId, 'icms-failed'),
      );
      return failed?.icmsStatus === 'registered' ? 'superseded' : 'failed';
    }
    return 'pending';
  }

  /**
   * ICMS gave no case number in the time the workflow waits: the referral is left `push-failed`
   * (`icms-registration-timeout`) for EACC to push again, unless it moved on meanwhile.
   */
  async recordIcmsTimeout(input: IcmsRegistrationInput): Promise<boolean> {
    return inEacc(this.db, async (tx) => {
      const [row] = await tx
        .select()
        .from(referralIntake)
        .where(eq(referralIntake.referralId, input.referralId))
        .for('update');
      if (!waitingFor(row, input)) return false;
      await recordPushFailed(tx, this.events, input.referralId, 'icms-registration-timeout');
      return true;
    });
  }
}

/** Work in EACC's row-level security tenant, as the system. */
function inEacc<T>(
  db: Database<ReportingSchema>,
  work: (tx: ReportingTransaction) => Promise<T>,
): Promise<T> {
  return withTenant(db, { tenant: EACC_TENANT, subject: SYSTEM_SUBJECT }, work);
}

/** The referral still waits for the case number of this push. */
function waitingFor(
  row: ReferralIntakeRow | undefined,
  input: IcmsRegistrationInput,
): row is ReferralIntakeRow {
  return row?.icmsStatus === 'pushed' && row.pushAttempts === input.attempt;
}
