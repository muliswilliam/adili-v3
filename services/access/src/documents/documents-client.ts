/** The upload purpose of representations' attachments and representatives' proofs (spec 10). */
export const ACCESS_REPRESENTATION_PURPOSE = 'access-representation';

/**
 * The documents the access service issues (documents.yaml `DocumentType`): a grant's
 * Confidential package (per-recipient watermark) and a declarant's Restricted certified copy.
 */
export type AccessDocumentType = 'access-package' | 'certified-copy';

/** Printed on every page of an access package, so a leaked copy traces to its recipient. */
export interface Watermark {
  recipientName: string;
  /** The `ARQ` or `LEA` reference of the grant. */
  reference: string;
  /** `YYYY-MM-DD` (Nairobi). */
  date: string;
}

/**
 * A request to render, sign and register a verifiable document (documents.yaml `IssueDocument`,
 * ADR-010). Ids and the watermark only: the disclosure travels in the request body, never in
 * logs, events or workflow history.
 */
export interface IssueDocumentRequest {
  type: AccessDocumentType;
  templateVersion: number;
  disclosureLevel: 'confidential' | 'restricted';
  issuerTenant: string;
  /** The owning record: `access-request:<uuid>`, `lea-request:<uuid>` or `certified-copy:<uuid>`. */
  subjectRef: string;
  /** Who may download it: the applicant, the law enforcement officer's person, or the declarant. */
  subjectPersonId: string | null;
  payload: Record<string, unknown>;
  watermark?: Watermark;
  /** How long the subject may download it (access packages). */
  downloadWindowDays?: number;
  /** The same key for the same document, so a retried request issues it once. */
  idempotencyKey: string;
}

/** What the access service keeps of an issued document (documents.yaml `IssuedDocument`). */
export interface IssuedDocument {
  id: string;
  verificationId: string;
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
  /** Throws `InternalApiRejected` when documents refuses the request. */
  abstract issue(request: IssueDocumentRequest): Promise<IssuedDocument>;

  /** Throws `UploadNotFound` or `UploadNotClean`. */
  abstract getCleanUpload(tenant: string, uploadId: string): Promise<CleanUpload>;

  /** Keeps the upload from the orphan sweep: something now refers to it. */
  abstract markLinked(tenant: string, uploadId: string): Promise<void>;

  /** Releases the upload to the orphan sweep: nothing refers to it any more. */
  abstract markUnlinked(tenant: string, uploadId: string): Promise<void>;
}
