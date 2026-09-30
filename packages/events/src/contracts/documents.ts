/**
 * Event contracts the documents service publishes about issued documents (ADR-010, spec 06),
 * read by declarations (the acknowledgement of a version), verification-api (its projection) and
 * audit. They carry identifiers and the public-safe payload the document type's disclosure level
 * allows, never the content of the document or who it is about.
 */

import { z } from 'zod';

/**
 * Document types the documents service issues, each with its templates (ADR-010 registry); later
 * specs add theirs.
 */
export const DOCUMENT_TYPES = ['acknowledgement-slip'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** A declaration version's acknowledgement slip (spec 06). */
export const ACKNOWLEDGEMENT_SLIP = 'acknowledgement-slip' satisfies DocumentType;

/** How much of a document the public verify page may show; fixed per document type. */
export const DISCLOSURE_LEVELS = ['public', 'restricted', 'confidential'] as const;
export type DisclosureLevel = (typeof DISCLOSURE_LEVELS)[number];

/** A verification record's status; the verify page answers `not-found` for unknown codes. */
export const DOCUMENT_STATUSES = ['valid', 'superseded', 'revoked', 'expired'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * A verification id as printed under the QR code: `ADL-` and 128 random bits in Crockford base32
 * (26 characters, no I, L, O or U), in groups of four with a last group of two.
 */
export const VERIFICATION_ID_PATTERN = /^ADL(?:-[0-9A-HJKMNP-TV-Z]{4}){6}-[0-9A-HJKMNP-TV-Z]{2}$/;

/** Crockford base32: no I, L, O or U, so a code read aloud or typed by hand survives. */
const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A fresh verification id (ADR-010): 128 random bits in Crockford base32 (26 characters, the
 * last carrying two zero bits), in its printed form. Random, so issued documents cannot be
 * enumerated from one code. `random` (16 bytes) is for tests.
 */
export function newVerificationId(
  random: Uint8Array = globalThis.crypto.getRandomValues(new Uint8Array(16)),
): string {
  if (random.length !== 16) throw new Error('a verification id takes 16 random bytes');
  let bits = 0n;
  for (const byte of random) bits = (bits << 8n) | BigInt(byte);
  bits <<= 2n;
  let encoded = '';
  for (let shift = 125n; shift >= 0n; shift -= 5n) {
    encoded += CROCKFORD_BASE32.charAt(Number((bits >> shift) & 31n));
  }
  return `ADL-${encoded.match(/.{1,4}/g)?.join('-') ?? ''}`;
}

/**
 * A verification id as typed or scanned, in its printed form: case, spaces and hyphens are
 * ignored, the `ADL` prefix is optional and Crockford look-alikes are read as digits (I and L as
 * 1, O as 0). Null when what remains is not 26 base32 characters.
 */
export function normalizeVerificationId(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]+/g, '');
  const body = (compact.startsWith('ADL') ? compact.slice(3) : compact)
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(body)) return null;
  return `ADL-${body.match(/.{1,4}/g)?.join('-') ?? ''}`;
}

/**
 * What the verify page may show of a public or restricted document; null for confidential
 * documents, whose page shows validity only.
 */
export interface PublicPayload extends Record<string, unknown> {
  /** The document type (a `DocumentType`; consumers ignore types they do not know). */
  type: string;
  /** The issuing Commission's name. */
  issuerName: string;
  /** The issuing Commission's issuer code, e.g. `PSC`. */
  issuerCode: string;
  issuedAt: string;
  /** The reference number the document is about, when it has one. */
  reference: string | null;
  /** The version of what the document is about (a declaration version), when versioned. */
  version: number | null;
}

/** Fields every document event carries. Subject: the document id; tenant: the issuer. */
export interface DocumentEventData extends Record<string, unknown> {
  documentId: string;
  verificationId: string;
  /**
   * A `DocumentType`. Typed open: a later spec adds types without a new event version, and
   * consumers ignore the types they do not handle.
   */
  documentType: string;
  templateVersion: number;
  disclosureLevel: DisclosureLevel;
  issuerTenant: string;
  /** The record the document is about, e.g. `declaration-version:<uuid>`. */
  subjectRef: string;
  publicPayload: PublicPayload | null;
  /** Where the verify page answers for it: the QR code's payload (`<verify origin>/v/<id>`). */
  verifyUrl: string;
  /** Hex SHA-256 of the issued PDF, for the verify page's file check. */
  sha256: string;
  issuedAt: string;
  status: DocumentStatus;
}

/** A document was rendered, signed, registered and stored. */
export const DOCUMENT_ISSUED = 'document.issued.v1';
export type DocumentIssuedData = DocumentEventData;

/** A document was replaced by a newer one (an amended declaration's acknowledgement). */
export const DOCUMENT_SUPERSEDED = 'document.superseded.v1';

export interface DocumentSupersededData extends DocumentEventData {
  /** The newer document. */
  supersededBy: string;
  /** Its verification id, which the verify page may link to when the level allows. */
  supersededByVerificationId: string;
  statusChangedAt: string;
}

/** Why a document was revoked: a category the verify page may show, never a free-text reason. */
export const REVOCATION_REASONS = ['issued-in-error', 'withdrawn', 'other'] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

/** A document was withdrawn; the verify page shows it revoked with the reason category. */
export const DOCUMENT_REVOKED = 'document.revoked.v1';

export interface DocumentRevokedData extends DocumentEventData {
  reasonCategory: RevocationReason;
  statusChangedAt: string;
}

/** A verification id in its printed form, as events carry it. */
export const verificationIdSchema = z.string().regex(VERIFICATION_ID_PATTERN);

const timestamp = z.iso.datetime({ offset: true });

/**
 * `DocumentEventData` as its consumers validate it, one schema for every consumer: each picks
 * the fields it reads (`.pick`) and may narrow one it relies on more (`.extend`). The public
 * payload is left open here; the verify page's projection keeps only the fields it shows.
 */
export const documentEventDataSchema = z.object({
  documentId: z.uuid(),
  verificationId: verificationIdSchema,
  documentType: z.string().min(1),
  templateVersion: z.int().positive(),
  disclosureLevel: z.enum(DISCLOSURE_LEVELS),
  issuerTenant: z.string().min(1),
  subjectRef: z.string().min(1),
  publicPayload: z.record(z.string(), z.unknown()).nullable(),
  verifyUrl: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  issuedAt: timestamp,
  status: z.enum(DOCUMENT_STATUSES),
});

/** `document.issued.v1` data. */
export const documentIssuedDataSchema = documentEventDataSchema;

/** `document.superseded.v1` data. */
export const documentSupersededDataSchema = documentEventDataSchema.extend({
  supersededBy: z.uuid(),
  supersededByVerificationId: verificationIdSchema,
  statusChangedAt: timestamp,
});

/** `document.revoked.v1` data. */
export const documentRevokedDataSchema = documentEventDataSchema.extend({
  reasonCategory: z.enum(REVOCATION_REASONS),
  statusChangedAt: timestamp,
});
