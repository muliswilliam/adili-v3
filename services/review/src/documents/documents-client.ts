/**
 * A short-lived link to a clean upload, with what the upload is (documents.yaml `UploadDownload`):
 * its purpose, the name it was given (display only) and its SHA-256.
 */
export interface UploadDownload {
  downloadUrl: string;
  expiresAt: string;
  purpose: string;
  fileName: string | null;
  sha256: string;
}

/** Why a document is revoked (documents.yaml `RevocationReason`). */
export type RevocationReason = 'issued-in-error';

/**
 * A request to render, sign and register a verifiable document (documents.yaml `IssueDocument`,
 * ADR-010), for the tenant the call acts for. The disclosure level and what the verify page shows
 * are the template's. For a clarification letter the payload names the clarification only: the
 * documents service pulls the fields the template renders from the review service's
 * `internalGetClarificationLetterPayload`, so no personal data travels in the request's logs or in
 * workflow history.
 */
export interface IssueDocumentRequest {
  type: 'clarification-letter';
  templateVersion: number;
  /** The owning record, e.g. `clarification:<uuid>`. One document per type and subject. */
  subjectRef: string;
  /** The person allowed to download the document (the documents owner rule). */
  subjectPersonId: string;
  payload: { clarificationId: string };
}

/** What the review service keeps of an issued document (documents.yaml `IssuedDocument`). */
export interface IssuedDocument {
  id: string;
  verificationId: string;
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
   * Commission has no such upload. Throws `InternalApiRejected` (409) when the upload is not
   * clean. Documents records the download in its own audit trail.
   */
  abstract getUploadDownload(uploadId: string, tenant: string): Promise<UploadDownload | null>;

  /**
   * Renders, signs and registers a verifiable document of the Commission (`issueDocument`,
   * ADR-010); one issued before for the same type and subject is answered again. Throws
   * `InternalApiRejected` when documents refuses the request.
   */
  abstract issue(request: IssueDocumentRequest, tenant: string): Promise<IssuedDocument>;

  /**
   * Revokes an issued document of the Commission (`revokeDocument`): its verify page then shows it
   * revoked, with the reason. A document already revoked is left as it is.
   */
  abstract revoke(documentId: string, tenant: string, reason: RevocationReason): Promise<void>;
}
