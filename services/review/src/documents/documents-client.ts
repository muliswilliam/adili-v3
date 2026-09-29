/** A short-lived link to a clean upload (documents.yaml `UploadDownload`). */
export interface UploadDownload {
  downloadUrl: string;
  expiresAt: string;
}

/**
 * A request to render, sign and register a verifiable document (documents.yaml `IssueDocument`,
 * ADR-010). For a clarification letter the payload names the clarification only: the documents
 * service pulls the fields the template renders from the review service's
 * `internalGetClarificationLetterPayload`, so no personal data travels in the request's logs or in
 * workflow history.
 */
export interface IssueDocumentRequest {
  type: 'clarification-letter';
  templateVersion: number;
  disclosureLevel: 'restricted';
  issuerTenant: string;
  /** The owning record, e.g. `clarification:<uuid>`. */
  subjectRef: string;
  /** The person allowed to download the document (the documents owner rule). */
  subjectPersonId: string;
  payload: { clarificationId: string };
  /** Shown on the verify page: reference, type, issuer and issue time. */
  publicPayload: {
    reference: string;
    type: 'clarification-letter';
    issuer: string;
    issuedAt: string;
  };
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
   * Commission has no such upload. Documents records the download in its own audit trail.
   */
  abstract getUploadDownload(uploadId: string, tenant: string): Promise<UploadDownload | null>;

  /**
   * Renders, signs and registers a verifiable document (`issueDocument`, ADR-010). Throws
   * `InternalApiRejected` when documents refuses the request.
   */
  abstract issue(request: IssueDocumentRequest): Promise<IssuedDocument>;
}
