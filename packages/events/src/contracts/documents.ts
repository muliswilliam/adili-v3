/**
 * Event contracts the documents service publishes about issued documents (ADR-010, spec 06),
 * read by declarations (the acknowledgement of a version), verification-api (its projection) and
 * audit. They carry identifiers and the public-safe payload the document type's disclosure level
 * allows, never the content of the document or who it is about.
 */

/**
 * Document types the documents service issues, each with its templates (ADR-010 registry); later
 * specs add theirs.
 */
export const DOCUMENT_TYPES = [
  'acknowledgement-slip',
  'clarification-letter',
  'access-package',
  'access-nil-letter',
  'certified-copy',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** A declaration version's acknowledgement slip (spec 06). */
export const ACKNOWLEDGEMENT_SLIP = 'acknowledgement-slip' satisfies DocumentType;

/** A Commission's request for clarification of a declaration (spec 07a, Act s.35). */
export const CLARIFICATION_LETTER = 'clarification-letter' satisfies DocumentType;

/**
 * The scoped disclosure granted on an access request or a law-enforcement request (spec 10):
 * confidential, watermarked with its recipient, downloadable by them for a window.
 */
export const ACCESS_PACKAGE = 'access-package' satisfies DocumentType;

/**
 * What a grant delivers instead of its access package when the Commission holds no declaration
 * within the granted scope (spec 10): a signed letter saying so, confidential, watermarked and
 * downloadable like the package.
 */
export const ACCESS_NIL_LETTER = 'access-nil-letter' satisfies DocumentType;

/** A declarant's certified copy of one of their submitted versions (spec 10): restricted. */
export const CERTIFIED_COPY = 'certified-copy' satisfies DocumentType;

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

/**
 * A download link to a document was handed to the person it is for, within its download window
 * when it has one. The access register records it as a download of a package or a certified
 * copy (by `subjectRef`). Subject: the document id; tenant: the issuer.
 */
export const DOCUMENT_DOWNLOADED = 'document.downloaded.v1';

export interface DocumentDownloadedData extends Record<string, unknown> {
  documentId: string;
  verificationId: string;
  /** A `DocumentType`, typed open as on every document event. */
  documentType: string;
  issuerTenant: string;
  /** The record the document is about, e.g. `access-request:<uuid>`. */
  subjectRef: string;
  /** `sub` of the person's token the link was handed to. */
  downloadedBy: string;
  downloadedAt: string;
  /** End of the download window; null when the document has none. */
  downloadExpiresAt: string | null;
}
