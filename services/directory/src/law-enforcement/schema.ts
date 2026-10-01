import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { persons } from '../persons/schema.js';

/** Where an officer account is: activation pending, signed in at least once, or disabled. */
export const LEA_OFFICER_STATES = ['invited', 'activated', 'revoked'] as const;
export type LeaOfficerState = (typeof LEA_OFFICER_STATES)[number];

/**
 * Law-enforcement agencies EACC issues officer accounts to (spec 10): reference data, seeded by
 * migration. `legalBasis` cites the statute the agency investigates or prosecutes under.
 * Platform-level, so not tenant-scoped under RLS.
 */
export const agencies = pgTable(
  'agencies',
  {
    /** Upper-case short code, e.g. `DCI`; the officer account's `agency` attribute. */
    code: text().primaryKey(),
    name: text().notNull(),
    legalBasis: text().notNull(),
    /** Display order. */
    sortOrder: integer().notNull(),
  },
  (table) => [check('agencies_code_pattern', sql`${table.code} ~ '^[A-Z][A-Z0-9]{1,9}$'`)],
);

/**
 * A law-enforcement officer's account for an agency (spec 10): the person (kind
 * `law-enforcement`, with the name, official email and phone) and the Keycloak account with the
 * `law-enforcement` role, tenant `lea` and the `agency` attribute. The officer's id is the person
 * id. Platform-level (an officer requests from any Commission), so not tenant-scoped under RLS.
 */
export const lawEnforcementOfficers = pgTable(
  'law_enforcement_officers',
  {
    personId: uuid()
      .primaryKey()
      .references(() => persons.id),
    agencyCode: text()
      .notNull()
      .references(() => agencies.code),
    state: text().$type<LeaOfficerState>().notNull(),
    invitedAt: timestamp({ withTimezone: true }).notNull(),
    activatedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    /** `sub` of the platform admin who provisioned the account. */
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('law_enforcement_officers_agency_code_idx').on(table.agencyCode),
    check(
      'law_enforcement_officers_state_check',
      sql`${table.state} in ('invited', 'activated', 'revoked')`,
    ),
    check(
      'law_enforcement_officers_activated_at_check',
      sql`${table.state} <> 'activated' or ${table.activatedAt} is not null`,
    ),
    check(
      'law_enforcement_officers_revoked_at_check',
      sql`(${table.state} = 'revoked') = (${table.revokedAt} is not null)`,
    ),
  ],
);

export const lawEnforcementSchema = { agencies, lawEnforcementOfficers };
