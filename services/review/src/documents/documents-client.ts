/** A short-lived link to a clean upload (documents.yaml `UploadDownload`). */
export interface UploadDownload {
  downloadUrl: string;
  expiresAt: string;
}

/** The documents service is unreachable or answered outside its contract. */
export class DocumentsUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DocumentsUnavailable';
  }
}

/**
 * What the review service asks of the documents service's internal API, one synchronous hop per
 * call (ADR-013). A Nest token: the service uses `HttpDocumentsClient`, tests a fake.
 */
export abstract class DocumentsClient {
  /**
   * A presigned GET on a clean upload of the Commission (`getUploadDownload`); null when the
   * Commission has no such upload. Documents records the download in its own audit trail.
   */
  abstract getUploadDownload(uploadId: string, tenant: string): Promise<UploadDownload | null>;
}
