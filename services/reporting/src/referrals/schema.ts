import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { ReferralGrounds } from '../projections/events.js';

/**
 * EACC's referral intake (spec 09): a row per referral a Commission sent to EACC
 * (`referral.sent.v1`), and where its hand-off to ICMS stands. Identifiers, the `RFL` reference,
 * grounds, statuses, error codes and the ICMS case number: never the declarant's name, ID number
 * or the referral's narrative, which the push pulls from review and passes to the gateway only.
 *
 * Row-level security: the Commission's context writes its referrals' rows (the inbox consumer);
 * EACC (`app.tenant` `eacc`) and platform read and update every Commission's.
 */

/**
 * reporting.yaml `IcmsStatus`: `not-pushed` until an EACC analyst pushes it; `pushed` once ICMS
 * accepted it without a case number yet; `registered` with the case number; `push-failed` when
 * the push could not be completed (pushed again to retry).
 */
export const ICMS_STATUSES = ['not-pushed', 'pushed', 'registered', 'push-failed'] as const;
export type IcmsStatus = (typeof ICMS_STATUSES)[number];

/**
 * Why a push failed (reporting.yaml `ReferralIntakeItem.error`): a code, never a message from
 * another system, which could carry personal data.
 */
export const ICMS_PUSH_ERRORS = [
  /** The review service could not be reached for the referral's ICMS payload. */
  'review-unavailable',
  /** Review knows no ICMS payload for the referral. */
  'payload-not-found',
  /** The integration-gateway or ICMS could not be reached, after retries with backoff. */
  'icms-unavailable',
  /** The gateway refused the request (a contract mismatch: retrying unchanged will not help). */
  'icms-rejected',
  /** ICMS answered that the registration failed. */
  'icms-failed',
  /** ICMS accepted the referral but gave no case number in the time the service waits. */
  'icms-registration-timeout',
] as const;
export type IcmsPushError = (typeof ICMS_PUSH_ERRORS)[number];

export const referralIntake = pgTable(
  'referral_intake',
  {
    referralId: uuid().primaryKey(),
    /** The Commission that sent the referral. */
    tenant: text().notNull(),
    /** `RFL-<ISSUER>-<YEAR>-<SEQ>-<CHECK>`: ICMS registers the referral idempotently by it. */
    reference: text().notNull(),
    grounds: text().$type<ReferralGrounds>().notNull(),
    cycleYear: integer().notNull(),
    /** The Confidential `referral-package` document of the documents service. */
    packageDocumentId: uuid().notNull(),
    sentAt: timestamp({ withTimezone: true }).notNull(),
    icmsStatus: text().$type<IcmsStatus>().notNull().default('not-pushed'),
    icmsCaseNumber: text(),
    icmsRegisteredAt: timestamp({ withTimezone: true }),
    /** How many times the referral was pushed: each push has its own registration workflow. */
    pushAttempts: integer().notNull().default(0),
    pushedAt: timestamp({ withTimezone: true }),
    /** The EACC officer who last pushed it (subject) and their name, as the intake shows it. */
    pushedBy: text(),
    pushedByName: text(),
    error: text().$type<IcmsPushError>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('referral_intake_sent_idx').on(table.sentAt, table.referralId),
    index('referral_intake_status_idx').on(table.icmsStatus, table.sentAt, table.referralId),
  ],
);

export const referralsSchema = { referralIntake };
