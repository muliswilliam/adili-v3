import type { components } from './documents-api.gen.js';

type Schemas = components['schemas'];

/**
 * The documents the reporting service issues (documents.yaml `DocumentType`): a submitted report's
 * Form M and receipt, EACC's national consolidated report, and the manifest of a published
 * open-data release.
 */
export type ReportDocumentType =
  'form-m' | 'compliance-report-receipt' | 'ncr' | 'open-data-manifest';

/**
 * A request to render, sign and register a verifiable document (documents.yaml `IssueDocument`,
 * ADR-010): the Restricted Form M as filed, its signed acknowledgement receipt, the Restricted
 * national consolidated report, or the Public manifest of an open-data release. The payload travels in the request body only: never in logs,
 * events or workflow history.
 */
export interface IssueDocumentRequest {
  type: ReportDocumentType;
  templateVersion: number;
  /**
   * The issuing tenant, sent as X-Acting-Tenant: the Commission, or EACC for the NCR and the
   * open-data manifest.
   */
  issuerTenant: string;
  /**
   * The owning record: `compliance-report:<uuid>`, `national-report:<uuid>` or
   * `open-data-release:<uuid>`.
   */
  subjectRef: string;
  /** No person owns a Commission's report or the national report. */
  subjectPersonId: null;
  /** The fields the template renders: the `form-m.v1` document, the receipt's, the NCR's or the manifest's. */
  payload:
    | Schemas['FormMPayload']
    | Schemas['ComplianceReportReceiptPayload']
    | Schemas['NcrPayload']
    | Schemas['OpenDataManifestPayload'];
  /** The same key for the same document, so a retried request issues it once. */
  idempotencyKey: string;
}

/** What the reporting service keeps of an issued document (documents.yaml `IssuedDocument`). */
export interface IssuedDocument {
  id: string;
  verificationId: string;
}

/** Why a document is revoked (documents.yaml `RevocationReason`), a category its verify page shows. */
export type RevocationReason = Schemas['RevocationReason'];

/** A request to revoke an issued document of the issuing tenant (documents.yaml `revokeDocument`). */
export interface RevokeDocumentRequest {
  documentId: string;
  /** The tenant that issued it, sent as X-Acting-Tenant. */
  issuerTenant: string;
  reason: RevocationReason;
  /** The same key for the same revocation, so a retried request revokes it once. */
  idempotencyKey: string;
}

/** The documents service is unreachable or answered outside its contract; activities retry. */
export class DocumentsUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DocumentsUnavailable';
  }
}

/**
 * The documents service's `issueDocument` and `revokeDocument`, one synchronous hop per document
 * (ADR-013). A Nest token: the service uses `HttpDocumentsClient`, tests a fake.
 */
export abstract class DocumentsClient {
  /** Throws `InternalApiRejected` when documents refuses the request. */
  abstract issue(request: IssueDocumentRequest): Promise<IssuedDocument>;

  /**
   * Revokes the document: its verify page then shows it revoked, with the reason. A document no
   * longer valid already (revoked) is left as it is. Throws `InternalApiRejected` when documents
   * refuses the request (e.g. not the tenant's document).
   */
  abstract revoke(request: RevokeDocumentRequest): Promise<void>;
}
