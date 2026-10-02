import type { FieldEnvelope } from '@adili/data-access';
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/**
 * A declarant's access to their own declarations (Administrative Mechanism 32): certified copies
 * of a submitted version, asked for in the portal or recorded by the access officer from a
 * written application made in person (possibly through a representative). Each issued copy is a
 * `self-access` entry of the access register.
 *
 * Row-level security (migration `access_rls`): the Commission's context reads and writes both;
 * the declarant reads their own certified copies (`app.person`).
 */

/**
 * access.yaml `CertifiedCopy.status`: `pending` until `CertifiedCopyWorkflow` has it issued;
 * `failed` when declarations has no such submitted version of the declarant at the Commission.
 */
export const CERTIFIED_COPY_STATUSES = ['pending', 'issued', 'failed'] as const;
export type CertifiedCopyStatus = (typeof CERTIFIED_COPY_STATUSES)[number];

export const certifiedCopies = pgTable(
  'certified_copies',
  {
    id: uuid().primaryKey(),
    /** The Commission the declaration was filed with. */
    tenant: text().notNull(),
    /** The Commission's name when the copy was asked for, as lists and messages show it. */
    commissionName: text().notNull(),
    /** The declarant: the subject of the Restricted `certified-copy` document. */
    personId: uuid().notNull(),
    declarationId: uuid().notNull(),
    version: integer().notNull(),
    /** The declaration's reference (ADR-011), known once declarations has rendered the version. */
    reference: text(),
    status: text().$type<CertifiedCopyStatus>().notNull(),
    documentId: uuid(),
    verificationId: text(),
    /** The officer-recorded application it was issued for; null when the declarant asked online. */
    applicationId: uuid(),
    /** Token subject of who asked: the declarant, or the access officer recording an application. */
    requestedBy: text().notNull(),
    /** Their name, as the register shows who acted. */
    requestedByName: text(),
    requestedAt: timestamp({ withTimezone: true }).notNull(),
    issuedAt: timestamp({ withTimezone: true }),
    failedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One copy per version and way of asking: asking again returns it (or retries a failed one).
    unique('certified_copies_version_key')
      .on(table.personId, table.declarationId, table.version, table.applicationId)
      .nullsNotDistinct(),
    index('certified_copies_person_idx').on(table.personId, table.requestedAt),
  ],
);

/** How an officer-recorded application's certified copy reaches the declarant. */
export const DELIVERY_METHODS = ['collection', 'dispatch'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

/**
 * The status of an officer-recorded self-access application: `recorded` while its certified copy
 * is being issued, `issued` once it is (`CertifiedCopyActivities`), `delivered` once the access
 * officer marked it collected or dispatched.
 */
export const SELF_ACCESS_STATUSES = ['recorded', 'issued', 'delivered'] as const;
export type SelfAccessStatus = (typeof SELF_ACCESS_STATUSES)[number];

/**
 * Who applied on the declarant's behalf, with the uploads (purpose `access-representation`)
 * proving their authority and identity. Their ID number is stored encrypted beside it.
 */
export interface SelfAccessRepresentative {
  name: string;
  authorityUploadId: string;
  idUploadId: string;
  /** The uploads' file names, as the officer's view lists them. */
  authorityFileName: string;
  idFileName: string;
}

export const selfAccessApplications = pgTable(
  'self_access_applications',
  {
    id: uuid().primaryKey(),
    tenant: text().notNull(),
    /** The declarant, resolved on the Commission's roster. */
    personId: uuid().notNull(),
    rosterRecordId: uuid().notNull(),
    /** The roster record's full name and personnel file number when it was recorded. */
    declarantName: text().notNull(),
    personnelFileNumber: text().notNull(),
    declarationId: uuid().notNull(),
    version: integer().notNull(),
    /** The declaration's reference (ADR-011), as the officer chose the version by it. */
    declarationReference: text().notNull(),
    /** What the access officer checked of the applicant's identity; no document numbers. */
    identityNote: text().notNull(),
    representative: jsonb().$type<SelfAccessRepresentative>(),
    /** The representative's ID number, encrypted (record id `self-access:<id>`). */
    representativeIdCiphertext: text(),
    representativeIdEnvelope: jsonb().$type<FieldEnvelope>(),
    status: text().$type<SelfAccessStatus>().notNull(),
    /** How the copy is to reach the declarant, as marked when it was recorded. */
    deliveryMethod: text().$type<DeliveryMethod>().notNull(),
    /** When the copy was collected or dispatched, and the access officer who marked it. */
    deliveredAt: timestamp({ withTimezone: true }),
    deliveredBy: text(),
    /** Received + 14 days. */
    deadlineAt: timestamp({ withTimezone: true }).notNull(),
    /** Token subject and name of the access officer who recorded it. */
    recordedBy: text().notNull(),
    recordedByName: text().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('self_access_applications_tenant_idx').on(table.tenant, table.deadlineAt)],
);

export const selfAccessSchema = { certifiedCopies, selfAccessApplications };
