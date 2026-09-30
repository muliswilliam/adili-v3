/**
 * Event contracts the documents service publishes about issued documents (ADR-010, spec 06),
 * read by declarations (the acknowledgement of a version), verification-api (its projection) and
 * audit. They carry identifiers and the public-safe payload the document type's disclosure level
 * allows, never the content of the document or who it is about.
 */

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
  /** The document type, e.g. `acknowledgement-slip`. */
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
  documentType: string;
  templateVersion: number;
  disclosureLevel: DisclosureLevel;
  issuerTenant: string;
  /** The record the document is about, e.g. `declaration-version:<uuid>`. */
  subjectRef: string;
  publicPayload: PublicPayload | null;
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
