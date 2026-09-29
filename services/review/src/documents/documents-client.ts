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
 * The letters the review service issues, and the record whose letter payload each names: the
 * documents service pulls the fields the template renders from the review service's letter payload
 * endpoint for that record (`internalGetClarificationLetterPayload`,
 * `internalGetDeterminationLetterPayload`, `internalGetActionLetterPayload`), so no personal data
 * travels in the request's logs or in workflow history.
 */
export type ReviewLetter =
  | { type: 'clarification-letter'; payload: { clarificationId: string } }
  | { type: 'decision-letter'; payload: { determinationId: string } }
  | { type: ActionLetterType; payload: { actionId: string } };

/** The letters of the enforcement ladder's steps (documents.yaml `DocumentType`). */
export type ActionLetterType = 'notice-to-comply' | 'warning';

/**
 * A request to render, sign and register a verifiable document (documents.yaml `IssueDocument`,
 * ADR-010): a Restricted letter of the review service.
 */
export type IssueDocumentRequest = ReviewLetter & {
  templateVersion: number;
  disclosureLevel: 'restricted';
  issuerTenant: string;
  /** The owning record, e.g. `clarification:<uuid>`. */
  subjectRef: string;
  /**
   * The person allowed to download the document (the documents owner rule); null for an officer
   * who never onboarded.
   */
  subjectPersonId: string | null;
  /** Shown on the verify page: reference, type, issuer and issue time. */
  publicPayload: {
    reference: string;
    type: ReviewLetter['type'];
    issuer: string;
    issuedAt: string;
  };
};

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
   * Renders, signs and registers a verifiable document (`issueDocument`, ADR-010). Throws
   * `InternalApiRejected` when documents refuses the request.
   */
  abstract issue(request: IssueDocumentRequest): Promise<IssuedDocument>;

  /**
   * Revokes an issued document of the Commission (`revokeDocument`): its verify page then shows it
   * revoked, with the reason. A document already revoked is left as it is.
   */
  abstract revoke(documentId: string, tenant: string, reason: RevocationReason): Promise<void>;
}
