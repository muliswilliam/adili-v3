import type {
  DisclosureLevel,
  DocumentStatus,
  PublicPayload,
  RevocationReason,
} from '@adili/events/contracts';
import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * What the public verify page may know of each issued document (ADR-010 §5), fed only by the
 * documents service's issuance events. Public-safe by construction: no subject, no tenant, no
 * document id, and the payload and link only when the disclosure level allows them.
 */
export const verificationProjection = pgTable(
  'verification_projection',
  {
    /** The verification id in its printed form, `ADL-XXXX-...-XX`. */
    verificationId: text().primaryKey(),
    status: text().$type<DocumentStatus>().notNull(),
    disclosureLevel: text().$type<DisclosureLevel>().notNull(),
    /** The fields the page shows; null for confidential documents. */
    publicPayload: jsonb().$type<PublicPayload>(),
    /** Hex SHA-256 of the issued PDF, for the browser-side file check. */
    sha256: text().notNull(),
    issuedAt: timestamp({ withTimezone: true }).notNull(),
    /** Verification id of the newer document, when the level allows linking to it. */
    supersededBy: text(),
    revokedReason: text().$type<RevocationReason>(),
    /**
     * When the documents service changed the status (the issue time until then): an event older
     * than the row, redelivered or reordered, never overwrites it.
     */
    updatedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'verification_projection_status_check',
      sql`${table.status} in ('valid', 'superseded', 'revoked', 'expired')`,
    ),
    check(
      'verification_projection_disclosure_level_check',
      sql`${table.disclosureLevel} in ('public', 'restricted', 'confidential')`,
    ),
    check('verification_projection_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'verification_projection_confidential_check',
      sql`${table.disclosureLevel} <> 'confidential' or (${table.publicPayload} is null and ${table.supersededBy} is null)`,
    ),
  ],
);

export type ProjectionRow = typeof verificationProjection.$inferSelect;

export const verificationSchema = { verificationProjection };
