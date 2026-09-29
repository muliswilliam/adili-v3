/** The upload purpose a declaration attachment must have been uploaded for (spec 05). */
export const DECLARATION_ATTACHMENT_PURPOSE = 'declaration-attachment';

/** A clean upload as the documents service describes it: what an attachment keeps of it. */
export interface CleanUpload {
  id: string;
  /** The purpose it was uploaded for, e.g. `declaration-attachment`. */
  purpose: string;
  /** Name of the file as uploaded; display only. Null when the uploader gave none. */
  fileName: string | null;
  /** Hex SHA-256 of the clean object. */
  sha256: string;
  /** Bytes. */
  size: number;
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

/** The documents service is unreachable, refused the service's token, or answered off contract. */
export class DocumentsUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DocumentsUnavailable';
  }
}

/**
 * The documents service's internal uploads API as declaration attachments need it (ADR-002: the
 * bytes stay there), acting for a Commission. A Nest token: the service uses
 * `HttpDocumentsClient`, tests a fake.
 */
export abstract class DocumentsClient {
  /**
   * The Commission's clean upload. Throws `UploadNotFound`, `UploadNotClean` or
   * `DocumentsUnavailable`.
   */
  abstract getCleanUpload(tenant: string, uploadId: string): Promise<CleanUpload>;

  /**
   * Records that the upload is linked, so the documents orphan sweep keeps it. Idempotent.
   * Throws like `getCleanUpload`.
   */
  abstract markLinked(tenant: string, uploadId: string): Promise<void>;
}
