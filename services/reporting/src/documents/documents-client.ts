import type { FormMV1 } from '@adili/forms';

/** The documents the reporting service issues for a submitted report (documents.yaml `DocumentType`). */
export type ReportDocumentType = 'form-m' | 'compliance-report-receipt';

/**
 * A request to render, sign and register a verifiable document (documents.yaml `IssueDocument`,
 * ADR-010): the Restricted Form M as filed, or its signed acknowledgement receipt. The payload
 * travels in the request body only: never in logs, events or workflow history.
 */
export interface IssueDocumentRequest {
  type: ReportDocumentType;
  templateVersion: number;
  disclosureLevel: 'restricted';
  issuerTenant: string;
  /** The owning record: `compliance-report:<uuid>`. */
  subjectRef: string;
  /** No person owns a Commission's report. */
  subjectPersonId: null;
  /** The fields the template renders: the `form-m.v1` document, or the receipt's fields. */
  payload: FormMV1 | Record<string, unknown>;
  /** Shown on the verify page: reference, type, issuer and issue time. */
  publicPayload: { reference: string; type: ReportDocumentType; issuer: string; issuedAt: string };
  /** The same key for the same document, so a retried request issues it once. */
  idempotencyKey: string;
}

/** What the reporting service keeps of an issued document (documents.yaml `IssuedDocument`). */
export interface IssuedDocument {
  id: string;
  verificationId: string;
}

/** The documents service is unreachable or answered outside its contract; activities retry. */
export class DocumentsUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DocumentsUnavailable';
  }
}

/**
 * The documents service's `issueDocument`, one synchronous hop per document (ADR-013). A Nest
 * token: the service uses `HttpDocumentsClient`, tests a fake.
 */
export abstract class DocumentsClient {
  /** Throws `InternalApiRejected` when documents refuses the request. */
  abstract issue(request: IssueDocumentRequest): Promise<IssuedDocument>;
}
