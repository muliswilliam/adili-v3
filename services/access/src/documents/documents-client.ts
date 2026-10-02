import type { components } from './documents-api.gen.js';

/** The upload purpose of representations' attachments and representatives' proofs (spec 10). */
export const ACCESS_REPRESENTATION_PURPOSE = 'access-representation';

/**
 * The documents the access service issues (documents.yaml `DocumentType`): a grant's
 * Confidential package (per-recipient watermark), or its nil letter when the scope holds nothing,
 * and a declarant's Restricted certified copy.
 */
export type AccessDocumentType = Extract<
  components['schemas']['DocumentType'],
  'access-package' | 'access-nil-letter' | 'certified-copy'
>;

/**
 * Printed on every page of an access package (documents.yaml `Watermark`): the recipient, the
 * `ARQ` or `LEA` reference of the grant and the date (`YYYY-MM-DD`), so a leaked copy traces to
 * its recipient.
 */
export type Watermark = components['schemas']['Watermark'];

/** documents.yaml `AccessPackagePayload` (access-package v1): the disclosure and the grant. */
export type AccessPackagePayload = components['schemas']['AccessPackagePayload'];

/** documents.yaml `AccessNilLetterPayload` (access-nil-letter v1): a grant with nothing to disclose. */
export type AccessNilLetterPayload = components['schemas']['AccessNilLetterPayload'];

/** documents.yaml `CertifiedCopyPayload` (certified-copy v1). */
export type CertifiedCopyPayload = components['schemas']['CertifiedCopyPayload'];

/**
 * A request to render, sign and register a verifiable document (documents.yaml `IssueDocument`,
 * ADR-010) for the Commission `tenant` (`X-Acting-Tenant`); the disclosure level is the
 * template's. The payload travels in the request body only, never in logs, events or workflow
 * history.
 */
export interface IssueDocumentRequest {
  /** The Commission issuing it. */
  tenant: string;
  type: AccessDocumentType;
  templateVersion: number;
  /** The owning record: `access-request:<uuid>`, `lea-request:<uuid>` or `certified-copy:<uuid>`. */
  subjectRef: string;
  /** Who may download it: the applicant, the law enforcement officer's person, or the declarant. */
  subjectPersonId: string;
  payload: AccessPackagePayload | AccessNilLetterPayload | CertifiedCopyPayload;
  watermark?: Watermark;
  /** How long the subject may download it (access packages). */
  downloadWindowDays?: number;
  /**
   * Token subjects of the Commission's staff who may download it too: the access officer who
   * recorded the in-person application a certified copy was ordered through.
   */
  additionalDownloaders?: string[];
  /** The same key for the same document, so a retried request issues it once. */
  idempotencyKey: string;
}

/** What the access service keeps of an issued document (documents.yaml `IssuedDocument`). */
export interface IssuedDocument {
  id: string;
  verificationId: string;
  issuedAt: Date;
  /** End of the subject's download window; null when the document has none. */
  downloadExpiresAt: Date | null;
}

/** A clean upload as the documents service describes it: what an attachment keeps of it. */
export interface CleanUpload {
  id: string;
  /** The purpose it was uploaded for; attachments need `access-representation`. */
  purpose: string;
  /** Token subject (`sub`) of the caller who reserved it. */
  uploadedBy: string;
  /** Name of the file as uploaded; display only. */
  fileName: string | null;
}

/** A short-lived link to a clean upload's bytes (documents.yaml `UploadDownload`). */
export interface UploadDownload {
  downloadUrl: string;
  /** ISO 8601; a few minutes ahead. */
  expiresAt: string;
}

/** The Commission has no upload with this id: unknown, or another Commission's. */
export class UploadNotFound extends Error {
  constructor(readonly uploadId: string) {
    super(`No upload ${uploadId} for this Commission`);
    this.name = 'UploadNotFound';
  }
}

/** The upload exists but is not clean (awaiting its bytes, infected, rejected, expired). */
export class UploadNotClean extends Error {
  constructor(readonly uploadId: string) {
    super(`Upload ${uploadId} is not clean`);
    this.name = 'UploadNotClean';
  }
}

/** The documents service is unreachable or answered outside its contract; callers retry. */
export class DocumentsUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DocumentsUnavailable';
  }
}

/**
 * The documents service's internal API as the access service needs it (ADR-013, one synchronous
 * hop per call): issuing packages and certified copies, and checking and linking the uploads
 * attached to representations. A Nest token: the service uses `HttpDocumentsClient`, tests a fake.
 */
export abstract class DocumentsClient {
  /** Throws `UpstreamRefused` when documents refuses the request. */
  abstract issue(request: IssueDocumentRequest): Promise<IssuedDocument>;

  /** Throws `UploadNotFound` or `UploadNotClean`. */
  abstract getCleanUpload(tenant: string, uploadId: string): Promise<CleanUpload>;

  /** A short-lived download link to a clean upload. Throws `UploadNotFound` or `UploadNotClean`. */
  abstract uploadDownload(tenant: string, uploadId: string): Promise<UploadDownload>;

  /** Keeps the upload from the orphan sweep: something now refers to it. */
  abstract markLinked(tenant: string, uploadId: string): Promise<void>;

  /** Releases the upload to the orphan sweep: nothing refers to it any more. */
  abstract markUnlinked(tenant: string, uploadId: string): Promise<void>;
}
