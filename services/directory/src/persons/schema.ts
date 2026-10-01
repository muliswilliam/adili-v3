import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * What a person is to the platform. A `declarant` has a national ID and an officer reference; a
 * `law-enforcement` officer (spec 10) has neither, only their agency account
 * (`law_enforcement_officers`).
 */
export const PERSON_KINDS = ['declarant', 'law-enforcement'] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];

/**
 * A person with an account: a declarant, one per national ID, linked to any number of roster
 * records across Commissions (`roster_records.person_id`), created when onboarding confirms with
 * the officer reference (OFR, ADR-011) and the Keycloak account; or a law-enforcement officer,
 * created when a platform admin provisions them, so that services address notifications and
 * packages to them by person id. Platform-level data (a person is global, ADR-006), so not
 * tenant-scoped under RLS.
 */
export const persons = pgTable(
  'persons',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    kind: text().$type<PersonKind>().notNull().default('declarant'),
    /** Digits only. Declarants only. */
    nationalId: text(),
    /** As confirmed at onboarding (the roster record's name), or as entered at provisioning. */
    fullName: text().notNull(),
    /** Declarants only. */
    ofr: text(),
    /** `sub` of the person's tokens. */
    keycloakUserId: text().notNull(),
    /** Verified at onboarding (the latest onboarding's contacts), or the official one provisioned. */
    email: text(),
    /** E.164, verified at onboarding, or as provisioned. */
    phone: text(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('persons_national_id_key').on(table.nationalId),
    uniqueIndex('persons_ofr_key').on(table.ofr),
    uniqueIndex('persons_keycloak_user_id_key').on(table.keycloakUserId),
    check('persons_kind_check', sql`${table.kind} in ('declarant', 'law-enforcement')`),
    check(
      'persons_declarant_identity_check',
      sql`${table.kind} <> 'declarant' or (${table.nationalId} is not null and ${table.ofr} is not null)`,
    ),
  ],
);

export const personsSchema = { persons };
