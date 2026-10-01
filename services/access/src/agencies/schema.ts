import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Law enforcement agencies whose officers may file requests (r.23): platform reference data,
 * no tenant. The directory provisions the agencies' officer accounts (role `law-enforcement`,
 * attribute `agency`); the access service keeps the agencies it names on requests, with the law
 * that empowers each, so a request shows its agency and legal basis without a call.
 */
export const agencies = pgTable('agencies', {
  /** Upper-case code, e.g. `DCI`, as the officer account's `agency` attribute carries it. */
  code: text().primaryKey(),
  name: text().notNull(),
  /** The statute empowering the agency to investigate, as the register cites it. */
  legalBasis: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const agenciesSchema = { agencies };
