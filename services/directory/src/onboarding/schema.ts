import { CONTACT_CHANNELS } from '@adili/contacts';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { commissions } from '../commissions/schema.js';
import { IDENTITY_DOCUMENT_KINDS, persons } from '../persons/schema.js';
import { CONTACT_SOURCES, rosterRecords } from '../roster/schema.js';
import {
  END_REASONS,
  IPRS_OUTCOMES,
  ONBOARDING_KINDS,
  ONBOARDING_OUTCOMES,
  ONBOARDING_STATES,
} from './session-state.js';

/**
 * Onboarding: the sessions that turn one roster record into one declarant account (spec 03) or a
 * member of the public into an applicant account (spec 10), their one-time codes and the
 * per-Commission failure counter. Every table is tenant-scoped under RLS (policies in migration
 * 0023), `tenant` being the Commission's slug; an applicant's session and codes have no tenant,
 * so only the `platform` context sees them.
 */

/**
 * Who supplied a session's contact: the roster record, the declarant at onboarding (written back
 * to the record once verified), or the applicant at start.
 */
export const SESSION_CONTACT_SOURCES = [...CONTACT_SOURCES, 'applicant'] as const;
export type SessionContactSource = (typeof SESSION_CONTACT_SOURCES)[number];

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const stateList = sql.raw(ONBOARDING_STATES.map((state) => `'${state}'`).join(', '));
const sourceList = sql.raw(SESSION_CONTACT_SOURCES.map((source) => `'${source}'`).join(', '));
const kindList = sql.raw(ONBOARDING_KINDS.map((kind) => `'${kind}'`).join(', '));
const documentKindList = sql.raw(IDENTITY_DOCUMENT_KINDS.map((kind) => `'${kind}'`).join(', '));

/**
 * One attempt to onboard, from identify (or an applicant's start) to a terminal state (see
 * `session-state.ts`). The browser holds the session secret in the portal's httpOnly cookie; only
 * its hash is stored.
 *
 * - A declarant's session is for one roster record of one Commission (`tenant`). The contacts in
 *   use are copied from the roster record at identify, or supplied by the declarant
 *   (`*_source = 'declarant'`) when the record has none.
 * - An applicant's session has no Commission and no roster record; it holds what the applicant
 *   entered at start (identity document, names, contacts with source `applicant`) until complete
 *   creates the person.
 */
export const onboardingSessions = pgTable(
  'onboarding_sessions',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    kind: text({ enum: ONBOARDING_KINDS }).notNull().default('declarant'),
    /** A declarant's Commission; null for an applicant. */
    tenant: text().references(() => commissions.slug),
    /** A declarant's roster record; null for an applicant. */
    rosterRecordId: uuid().references(() => rosterRecords.id),
    /** SHA-256 of the session secret, hex (`secret.ts`). */
    secretHash: text().notNull(),
    state: text({ enum: ONBOARDING_STATES }).notNull(),
    email: text(),
    emailSource: text({ enum: SESSION_CONTACT_SOURCES }),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    /** E.164. */
    phone: text(),
    phoneSource: text({ enum: SESSION_CONTACT_SOURCES }),
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
    /** An applicant's identity document: national ID (checked with IPRS at start) or passport. */
    documentKind: text({ enum: IDENTITY_DOCUMENT_KINDS }),
    /** Digits of a national ID; upper-case letters and digits of a passport number. */
    documentNumber: text(),
    /** A passport's issuing country, ISO 3166-1 alpha-2; null for a national ID. */
    documentCountry: text(),
    /** An applicant's names as entered. */
    surname: text(),
    firstName: text(),
    otherNames: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    completedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    /** The target of `onboarding_otps`' foreign key: a code belongs to its session's tenant. */
    unique('onboarding_sessions_id_tenant_key').on(table.id, table.tenant),
    index('onboarding_sessions_tenant_created_at_idx').on(table.tenant, table.createdAt),
    index('onboarding_sessions_roster_record_id_idx').on(table.rosterRecordId),
    /** The expiry sweep: live sessions by expiry. */
    index('onboarding_sessions_live_expires_at_idx')
      .on(table.expiresAt)
      .where(sql`${table.state} not in ('confirmed', 'identity-mismatch', 'expired')`),
    check('onboarding_sessions_state_check', sql`${table.state} in (${stateList})`),
    check('onboarding_sessions_kind_check', sql`${table.kind} in (${kindList})`),
    /** A declarant's session has a Commission and a record; an applicant's what they entered. */
    check(
      'onboarding_sessions_kind_columns_check',
      sql`(${table.kind} = 'declarant' and ${table.tenant} is not null and ${table.rosterRecordId} is not null and ${table.documentKind} is null) or (${table.kind} = 'applicant' and ${table.tenant} is null and ${table.rosterRecordId} is null and ${table.documentKind} in (${documentKindList}) and ${table.documentNumber} is not null and (${table.documentKind} = 'passport') = (${table.documentCountry} is not null) and ${table.surname} is not null and ${table.firstName} is not null)`,
    ),
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
    sessionId: uuid().notNull(),
    channel: text({ enum: CONTACT_CHANNELS }).notNull(),
    /**
     * Denormalised from the session for RLS; the foreign key keeps it the session's. Null for an
     * applicant's session, which has no tenant.
     */
    tenant: text(),
    /** `otpCodeHmac(key, sessionId, channel, code)`: keyed per session (HKDF, `sessionOtpKey`). */
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
    /** Not enforced for a null tenant (an applicant's code): the session's id alone then is. */
    foreignKey({
      name: 'onboarding_otps_session_fk',
      columns: [table.sessionId, table.tenant],
      foreignColumns: [onboardingSessions.id, onboardingSessions.tenant],
    }).onDelete('cascade'),
    foreignKey({
      name: 'onboarding_otps_session_id_fk',
      columns: [table.sessionId],
      foreignColumns: [onboardingSessions.id],
    }).onDelete('cascade'),
    check('onboarding_otps_channel_check', sql`${table.channel} in ('email', 'phone')`),
  ],
);

/**
 * Failed onboarding attempts per Commission and hour, whatever the caller: identify answered
 * `no-match`, or a session ran out of codes or resends. A stale roster or an attack; reporting
 * officers read the recent count. Past `ONBOARDING_ABUSE_THRESHOLD` in one window the directory
 * records `onboarding.abuse-threshold.v1`.
 */
export const onboardingFailures = pgTable(
  'onboarding_failures',
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
  onboardingFailures,
};
