import type { EventPublisher } from '@adili/events';
import { eq } from 'drizzle-orm';

import type { ReportingTransaction } from '../compliance-reports/reports.js';
import type { ReferralSentData } from '../projections/events.js';
import {
  REFERRAL_ICMS_PUSH_FAILED,
  REFERRAL_ICMS_PUSHED,
  REFERRAL_ICMS_REGISTERED,
  type ReferralIcmsPushedData,
  type ReferralIcmsPushFailedData,
  type ReferralIcmsRegisteredData,
} from './events.js';
import { type IcmsPushError, referralIntake } from './schema.js';

export type ReferralIntakeRow = typeof referralIntake.$inferSelect;

/**
 * EACC's intake of a referral a Commission sent (`referral.sent.v1`): a `not-pushed` row, once.
 * Runs in the Commission's context, in the inbox transaction of the event.
 */
export async function takeInReferral(
  tx: Pick<ReportingTransaction, 'insert'>,
  tenant: string,
  data: ReferralSentData,
): Promise<void> {
  await tx
    .insert(referralIntake)
    .values({
      referralId: data.referralId,
      tenant,
      reference: data.reference,
      grounds: data.grounds,
      cycleYear: data.cycleYear,
      packageDocumentId: data.packageDocumentId,
      sentAt: new Date(data.sentAt),
    })
    .onConflictDoNothing();
}

/** The referral's intake row locked for a change; undefined for none. */
export async function lockIntake(
  tx: ReportingTransaction,
  referralId: string,
): Promise<ReferralIntakeRow | undefined> {
  const [row] = await tx
    .select()
    .from(referralIntake)
    .where(eq(referralIntake.referralId, referralId))
    .for('update');
  return row;
}

/**
 * ICMS registered the referral under `caseNumber`: stored with `registered` and
 * `referral.icms-registered.v1` published, once. A referral registered already is left as it is.
 */
export async function recordRegistered(
  tx: ReportingTransaction,
  events: EventPublisher,
  referralId: string,
  registration: { caseNumber: string; registeredAt: Date },
): Promise<ReferralIntakeRow | undefined> {
  const row = await lockIntake(tx, referralId);
  if (!row || row.icmsStatus === 'registered') return row;
  const [registered] = await tx
    .update(referralIntake)
    .set({
      icmsStatus: 'registered',
      icmsCaseNumber: registration.caseNumber,
      icmsRegisteredAt: registration.registeredAt,
      error: null,
    })
    .where(eq(referralIntake.referralId, referralId))
    .returning();
  await events.record<ReferralIcmsRegisteredData>(tx, {
    type: REFERRAL_ICMS_REGISTERED,
    subject: referralId,
    tenant: row.tenant,
    data: {
      referralId,
      tenant: row.tenant,
      icmsCaseNumber: registration.caseNumber,
      registeredAt: registration.registeredAt.toISOString(),
    },
  });
  return registered;
}

/**
 * ICMS accepted the referral without a case number yet: `pushed` and
 * `referral.icms-pushed.v1`. A referral registered meanwhile is left as it is.
 */
export async function recordPushed(
  tx: ReportingTransaction,
  events: EventPublisher,
  referralId: string,
): Promise<ReferralIntakeRow | undefined> {
  const row = await lockIntake(tx, referralId);
  if (!row || row.icmsStatus === 'registered') return row;
  const [pushed] = await tx
    .update(referralIntake)
    .set({ icmsStatus: 'pushed', error: null })
    .where(eq(referralIntake.referralId, referralId))
    .returning();
  await events.record<ReferralIcmsPushedData>(tx, {
    type: REFERRAL_ICMS_PUSHED,
    subject: referralId,
    tenant: row.tenant,
    data: {
      referralId,
      tenant: row.tenant,
      reference: row.reference,
      pushedAt: (row.pushedAt ?? new Date()).toISOString(),
    },
  });
  return pushed;
}

/**
 * The push could not be completed: `push-failed` with the reason's code and
 * `referral.icms-push-failed.v1`; EACC pushes again to retry. A referral registered meanwhile is
 * left as it is.
 */
export async function recordPushFailed(
  tx: ReportingTransaction,
  events: EventPublisher,
  referralId: string,
  error: IcmsPushError,
): Promise<ReferralIntakeRow | undefined> {
  const row = await lockIntake(tx, referralId);
  if (!row || row.icmsStatus === 'registered') return row;
  const [failed] = await tx
    .update(referralIntake)
    .set({ icmsStatus: 'push-failed', error })
    .where(eq(referralIntake.referralId, referralId))
    .returning();
  await events.record<ReferralIcmsPushFailedData>(tx, {
    type: REFERRAL_ICMS_PUSH_FAILED,
    subject: referralId,
    tenant: row.tenant,
    data: { referralId, tenant: row.tenant, reference: row.reference, error },
  });
  return failed;
}
