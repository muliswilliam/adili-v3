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
 * (`law_enforcement_officers`); an `applicant` (spec 10) has the identity document they onboarded
 * with to request access to declarations, and its identity status.
 */
export const PERSON_KINDS = ['declarant', 'law-enforcement', 'applicant'] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];

/** The identity document an applicant onboarded with. */
export const IDENTITY_DOCUMENT_KINDS = ['national-id', 'passport'] as const;
export type IdentityDocumentKind = (typeof IDENTITY_DOCUMENT_KINDS)[number];

/**
 * Whether an applicant's identity is established: `verified` by IPRS at onboarding (national ID)
 * or by an access officer who checked the particulars entered (passport), else
 * `pending-verification`. The account carries it as the `identityStatus` attribute.
 */
export const IDENTITY_STATUSES = ['verified', 'pending-verification'] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

/**
 * The languages a declarant may prefer: those clarification letters are issued in (English and
 * Swahili, the letter language). Spec 07c FE-3: the composer and Draft with AI start in it.
 */
export const PREFERRED_LANGUAGES = ['en', 'sw'] as const;
export type PreferredLanguage = (typeof PREFERRED_LANGUAGES)[number];

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * A person with an account: a declarant, one per national ID, linked to any number of roster
 * records across Commissions (`roster_records.person_id`), created when onboarding confirms with
 * the officer reference (OFR, ADR-011) and the Keycloak account; a law-enforcement officer,
 * created when a platform admin provisions them; or an applicant, one per identity document,
 * created when applicant onboarding completes, with no tenant, no roster record and no OFR.
 * Services address notifications and packages to any of them by person id. Platform-level data
 * (a person is global, ADR-006), so not tenant-scoped under RLS.
 *
 * A declarant and an applicant are separate persons, with separate accounts, even for one human:
 * national IDs are unique per kind.
 */
export const persons = pgTable(
  'persons',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    kind: text().$type<PersonKind>().notNull().default('declarant'),
    /** Digits only. Every declarant's; an applicant's who onboarded with a national ID. */
    nationalId: text(),
    /**
     * As confirmed at onboarding (the roster record's name), as entered at provisioning, or as
     * an applicant entered it (first, other and surname).
     */
    fullName: text().notNull(),
    /** Declarants only. */
    ofr: text(),
    /** An applicant's who onboarded with a passport: upper-case letters and digits. */
    passportNumber: text(),
    /** The passport's issuing country, ISO 3166-1 alpha-2. */
    passportCountry: text(),
    /** Applicants only. */
    identityStatus: text().$type<IdentityStatus>(),
    /** When an applicant's identity became `verified`. */
    identityVerifiedAt: timestamp({ withTimezone: true }),
    /** Who verified it: the access officer's subject; null when IPRS did at onboarding. */
    identityVerifiedBy: text(),
    /** `sub` of the person's tokens. */
    keycloakUserId: text().notNull(),
    /**
     * Verified at onboarding (a declarant's latest onboarding's), the official one provisioned,
     * or an applicant's as entered, which their set-password link proves.
     */
    email: text(),
    /** E.164, verified at onboarding, or as provisioned. */
    phone: text(),
    /** Declarants only: the language they chose in the portal; null until they choose one. */
    preferredLanguage: text().$type<PreferredLanguage>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('persons_kind_national_id_key').on(table.kind, table.nationalId),
    uniqueIndex('persons_passport_key').on(table.passportCountry, table.passportNumber),
    uniqueIndex('persons_ofr_key').on(table.ofr),
    uniqueIndex('persons_keycloak_user_id_key').on(table.keycloakUserId),
    check('persons_kind_check', sql`${table.kind} in (${list(PERSON_KINDS)})`),
    check(
      'persons_declarant_identity_check',
      sql`${table.kind} <> 'declarant' or (${table.nationalId} is not null and ${table.ofr} is not null)`,
    ),
    check(
      'persons_applicant_identity_check',
      sql`${table.kind} <> 'applicant' or (${table.ofr} is null and ${table.identityStatus} is not null and (${table.nationalId} is null) <> (${table.passportNumber} is null) and (${table.passportNumber} is null) = (${table.passportCountry} is null))`,
    ),
    check(
      'persons_applicant_only_check',
      sql`${table.kind} = 'applicant' or (${table.passportNumber} is null and ${table.passportCountry} is null and ${table.identityStatus} is null)`,
    ),
    check(
      'persons_preferred_language_check',
      sql`${table.preferredLanguage} is null or ${table.preferredLanguage} in (${list(PREFERRED_LANGUAGES)})`,
    ),
    check(
      'persons_identity_status_check',
      sql`${table.identityStatus} is null or ${table.identityStatus} in (${list(IDENTITY_STATUSES)})`,
    ),
    check(
      'persons_identity_verified_check',
      sql`${table.identityStatus} is null or (${table.identityStatus} = 'verified') = (${table.identityVerifiedAt} is not null)`,
    ),
  ],
);

export const personsSchema = { persons };
