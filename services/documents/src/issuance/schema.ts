import type { DisclosureLevel, DocumentStatus, PublicPayload } from '@adili/events/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Issued documents (ADR-010), tenant data of the issuing Commission under RLS (migration 0008),
 * readable by the person they are about. Insert-only: what was issued never changes; its status
 * lives on the verification record. One document per type and subject: issuing again for the
 * same subject returns the one issued.
 */
export const issuedDocuments = pgTable(
  'issued_documents',
  {
    id: uuid().primaryKey(),
    /** The issuing Commission. */
    tenant: text().notNull(),
    type: text().notNull(),
    templateVersion: integer().notNull(),
    disclosureLevel: text().$type<DisclosureLevel>().notNull(),
    /** The record the document is about, e.g. `declaration-version:<uuid>`. */
    subjectRef: text().notNull(),
    /**
     * The reference number of what the document is about (the declaration's), when it has one:
     * the documents about one reference supersede each other.
     */
    reference: text(),
    /**
     * The version of what the document is about (a declaration version), when versioned: of the
     * documents about one reference, the highest version's supersedes the rest.
     */
    subjectVersion: integer(),
    /** The person who may download it (the declarant); null when no person may. */
    subjectPersonId: uuid(),
    verificationId: text().notNull().unique(),
    /** Key in the issued bucket: `issued/<id>.pdf`. */
    objectKey: text().notNull().unique(),
    /** Hex SHA-256 of the signed PDF as stored. */
    sha256: text().notNull(),
    size: integer().notNull(),
    /** Common name of the PAdES signing certificate. */
    signerName: text().notNull(),
    /** Hex SHA-256 of the signing certificate (DER). */
    signerCertificateSha256: text().notNull(),
    issuedAt: timestamp({ withTimezone: true }).notNull(),
    /** `sub` of the service or user that asked for the document. */
    issuedBy: text().notNull(),
    /**
     * End of the download window (an access package's fourteen days): the subject person gets
     * no download link from then on. Null when the document has none.
     */
    downloadExpiresAt: timestamp({ withTimezone: true }),
    /**
     * Token subjects (`sub`) of staff of the issuing Commission who may download the document as
     * well as its subject person: the access officer who recorded an in-person self-access
     * application, to print the certified copy they hand over. Empty for most documents.
     */
    additionalDownloaders: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (table) => [
    unique('issued_documents_type_subject_key').on(table.type, table.subjectRef),
    index('issued_documents_subject_person_idx').on(table.subjectPersonId),
    index('issued_documents_reference_idx').on(table.tenant, table.type, table.reference),
    check(
      'issued_documents_disclosure_level_check',
      sql`${table.disclosureLevel} in ('public', 'restricted', 'confidential')`,
    ),
    check('issued_documents_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * Verification records (ADR-010 §3): what the verify page answers for a code, signed with
 * Ed25519 through OpenBao Transit so a database edit is detectable. Re-signed on every status
 * change. Same tenancy as the document.
 */
export const verificationRecords = pgTable(
  'verification_records',
  {
    /** The verification id printed under the QR code. */
    id: text().primaryKey(),
    documentId: uuid()
      .notNull()
      .unique()
      .references(() => issuedDocuments.id),
    tenant: text().notNull(),
    documentType: text().notNull(),
    templateVersion: integer().notNull(),
    disclosureLevel: text().$type<DisclosureLevel>().notNull(),
    issuedAt: timestamp({ withTimezone: true }).notNull(),
    contentSha256: text().notNull(),
    /** Only what the level allows the verify page to show; null for confidential documents. */
    publicPayload: jsonb().$type<PublicPayload>(),
    status: text().$type<DocumentStatus>().notNull().default('valid'),
    statusReasonCategory: text(),
    supersededBy: uuid().references(() => issuedDocuments.id),
    statusChangedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    /** Base64 Ed25519 signature over the canonical record. */
    recordSignature: text().notNull(),
    recordSigningKeyVersion: integer().notNull(),
  },
  (table) => [
    check(
      'verification_records_status_check',
      sql`${table.status} in ('valid', 'superseded', 'revoked', 'expired')`,
    ),
    check(
      'verification_records_superseded_check',
      sql`(${table.status} = 'superseded') = (${table.supersededBy} is not null)`,
    ),
    check(
      'verification_records_public_payload_check',
      sql`(${table.disclosureLevel} = 'confidential') = (${table.publicPayload} is null)`,
    ),
  ],
);

export const issuanceSchema = { issuedDocuments, verificationRecords };
