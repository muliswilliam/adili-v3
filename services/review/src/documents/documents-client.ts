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

/** A short-lived link to an issued document's signed PDF (documents.yaml `DocumentDownload`). */
export interface DocumentDownload {
  downloadUrl: string;
  expiresAt: string;
  sha256: string;
}

/** Why review revokes a document: the subset of documents.yaml `RevocationReason` it sends. */
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
export type ActionLetterType =
  'notice-to-comply' | 'warning' | 'salary-stoppage' | 'disciplinary-referral';

/** A letter of the review service, which its template issues Restricted (ADR-010). */
export type IssueLetterRequest = ReviewLetter & {
  templateVersion: number;
  /** The owning record, e.g. `clarification:<uuid>`. One document per type and subject. */
  subjectRef: string;
  /**
   * The person allowed to download the document (the documents owner rule); null for an officer
   * who never onboarded.
   */
  subjectPersonId: string | null;
};

/**
 * A referral's Confidential evidence package (`referral-package`, ADR-010): the documents service
 * pulls its fields from `internalGetReferralPackagePayload`. Nobody owns it as a person (the
 * declarant is never told of a referral, spec 08).
 */
export interface IssuePackageRequest {
  type: 'referral-package';
  payload: { referralId: string };
  templateVersion: number;
  /** `referral:<uuid>`. */
  subjectRef: string;
  subjectPersonId: null;
}

/**
 * A document the review service asks documents to render, sign and register (documents.yaml
 * `IssueDocument`, ADR-010), for the tenant the call acts for. The disclosure level and what the
 * verify page shows are the template's.
 */
export type IssueDocumentRequest = IssueLetterRequest | IssuePackageRequest;

/** An issued document as documents describes it to its issuer (`internalGetDocument`). */
export interface IssuedDocumentFacts {
  id: string;
  type: string;
  /** SHA-256 of the signed PDF, lowercase hex. */
  sha256: string;
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
   * clean. Documents records the download in its own audit trail, naming `actingSubject` as whom
   * it was read for (ADR-013 §8.6): the reviewer, or the declarant whose response attaches it.
   */
  abstract getUploadDownload(
    uploadId: string,
    tenant: string,
    actingSubject: string,
  ): Promise<UploadDownload | null>;

  /**
   * A presigned GET on the signed PDF of a document the Commission issued
   * (`internalGetDocumentDownload`), for a staff member the review service has let see it; null
   * when the Commission issued no such document. Documents records the download in its own audit
   * trail, naming the person the document is about and `actingSubject`, the staff member it was
   * read for (ADR-013 §8.6).
   */
  abstract getIssuedDocumentDownload(
    documentId: string,
    tenant: string,
    actingSubject: string,
  ): Promise<DocumentDownload | null>;

  /**
   * Renders, signs and registers a verifiable document of the Commission (`issueDocument`,
   * ADR-010); one issued before for the same type and subject is answered again. Throws
   * `InternalApiRejected` when documents refuses the request.
   */
  abstract issue(request: IssueDocumentRequest, tenant: string): Promise<IssuedDocument>;

  /**
   * What documents holds of a document the Commission issued (`internalGetDocument`): its type and
   * SHA-256; null when the Commission issued no such document.
   */
  abstract getIssuedDocument(
    documentId: string,
    tenant: string,
  ): Promise<IssuedDocumentFacts | null>;

  /**
   * Revokes an issued document of the Commission (`revokeDocument`): its verify page then shows it
   * revoked, with the reason. A document already revoked is left as it is.
   */
  abstract revoke(documentId: string, tenant: string, reason: RevocationReason): Promise<void>;
}
