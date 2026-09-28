import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { commissions } from '../commissions/schema.js';
import { persons } from '../persons/schema.js';
import { CONTACT_SOURCES, rosterRecords } from '../roster/schema.js';
import {
  END_REASONS,
  IPRS_OUTCOMES,
  ONBOARDING_OUTCOMES,
  ONBOARDING_STATES,
  OTP_CHANNELS,
} from './session-state.js';

/**
 * Declarant onboarding (spec 03): the sessions that turn one roster record into one declarant
 * account, their one-time codes and the per-Commission failure counter. Every table is
 * tenant-scoped under RLS (policies in migration 0023), `tenant` being the Commission's slug.
 */

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const stateList = sql.raw(ONBOARDING_STATES.map((state) => `'${state}'`).join(', '));
const sourceList = sql.raw(CONTACT_SOURCES.map((source) => `'${source}'`).join(', '));

/**
 * One attempt to onboard as a roster record, from identify to a terminal state (see
 * `session-state.ts`). The browser holds the session secret in the portal's httpOnly cookie; only
 * its hash is stored. The contacts in use are copied from the roster record at identify, or
 * supplied by the declarant (`*_source = 'declarant'`) when the record has none.
 */
export const onboardingSessions = pgTable(
  'onboarding_sessions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    tenant: text()
      .notNull()
      .references(() => commissions.slug),
    rosterRecordId: uuid()
      .notNull()
      .references(() => rosterRecords.id),
    /** SHA-256 of the session secret, hex (`secret.ts`). */
    secretHash: text().notNull(),
    state: text({ enum: ONBOARDING_STATES }).notNull(),
    email: text(),
    emailSource: text({ enum: CONTACT_SOURCES }),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    /** E.164. */
    phone: text(),
    phoneSource: text({ enum: CONTACT_SOURCES }),
    phoneVerifiedAt: timestamp({ withTimezone: true }),
    /** What IPRS said at confirm; null until then. */
    iprsOutcome: text({ enum: IPRS_OUTCOMES }),
    /** How confirm ended: the declarant-facing outcome. */
    outcome: text({ enum: ONBOARDING_OUTCOMES }),
    /** Why the session ended, as `onboarding.session.ended.v1` reports it. */
    endReason: text({ enum: END_REASONS }),
    /** The person the record was linked to at confirm. */
    personId: uuid().references(() => persons.id),
    /** When the set-password email was last requested, for its resend cooldown. */
    passwordEmailSentAt: timestamp({ withTimezone: true }),
    /** HMAC of the client IP at identify (`ONBOARDING_HMAC_KEY`), for abuse analysis. */
    clientIpHash: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    completedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('onboarding_sessions_tenant_created_at_idx').on(table.tenant, table.createdAt),
    index('onboarding_sessions_roster_record_id_idx').on(table.rosterRecordId),
    /** The expiry sweep: live sessions by expiry. */
    index('onboarding_sessions_live_expires_at_idx')
      .on(table.expiresAt)
      .where(sql`${table.state} not in ('confirmed', 'identity-mismatch', 'expired')`),
    check('onboarding_sessions_state_check', sql`${table.state} in (${stateList})`),
    check(
      'onboarding_sessions_email_source_check',
      sql`(${table.email} is null) = (${table.emailSource} is null) and (${table.emailSource} is null or ${table.emailSource} in (${sourceList}))`,
    ),
    check(
      'onboarding_sessions_phone_source_check',
      sql`(${table.phone} is null) = (${table.phoneSource} is null) and (${table.phoneSource} is null or ${table.phoneSource} in (${sourceList}))`,
    ),
    check(
      'onboarding_sessions_completed_at_check',
      sql`(${table.state} in ('confirmed', 'identity-mismatch', 'expired')) = (${table.completedAt} is not null)`,
    ),
  ],
);

/**
 * The current one-time code of a session's channel: its HMAC (never the code), expiry, wrong
 * attempts, resends and when it was sent (for the resend cooldown). One row per channel,
 * replaced by each resend.
 */
export const onboardingOtps = pgTable(
  'onboarding_otps',
  {
    sessionId: uuid()
      .notNull()
      .references(() => onboardingSessions.id, { onDelete: 'cascade' }),
    channel: text({ enum: OTP_CHANNELS }).notNull(),
    /** Denormalised from the session for RLS. */
    tenant: text().notNull(),
    /** `otpCodeHmac(key, sessionId, channel, code)`. */
    codeHmac: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /** Wrong codes entered against the current code. */
    attempts: integer().notNull().default(0),
    /** Codes sent after the first. */
    resends: integer().notNull().default(0),
    lastSentAt: timestamp({ withTimezone: true }).notNull(),
    verifiedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.channel] }),
    check('onboarding_otps_channel_check', sql`${table.channel} in ('email', 'phone')`),
  ],
);

/**
 * Failed identify attempts (`no-match`) per Commission and hour, whatever the cause and caller:
 * a stale roster or an attack. Past `ONBOARDING_ABUSE_THRESHOLD` in one window the directory
 * records `onboarding.abuse-threshold.v1`.
 */
export const onboardingAttempts = pgTable(
  'onboarding_attempts',
  {
    tenant: text()
      .notNull()
      .references(() => commissions.slug),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    failures: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenant, table.windowStart] })],
);

export const onboardingSchema = {
  onboardingSessions,
  onboardingOtps,
  onboardingAttempts,
};
