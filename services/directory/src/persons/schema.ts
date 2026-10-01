import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * A declarant: one per national ID, linked to any number of roster records across Commissions
 * (`roster_records.person_id`). Created when onboarding confirms, with the officer reference
 * (OFR, ADR-011) and the Keycloak account. Platform-level data (a person is global, ADR-006),
 * so not tenant-scoped under RLS.
 */
export const persons = pgTable(
  'persons',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    /** Digits only. */
    nationalId: text().notNull(),
    /** As confirmed at onboarding (the roster record's name). */
    fullName: text().notNull(),
    ofr: text().notNull(),
    /** `sub` of the person's tokens. */
    keycloakUserId: text().notNull(),
    /** Verified at onboarding; the latest onboarding's contacts. */
    email: text(),
    /** E.164, verified at onboarding. */
    phone: text(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('persons_national_id_key').on(table.nationalId),
    uniqueIndex('persons_ofr_key').on(table.ofr),
    uniqueIndex('persons_keycloak_user_id_key').on(table.keycloakUserId),
  ],
);

export const personsSchema = { persons };
