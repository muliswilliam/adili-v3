import { createHash, randomUUID } from 'node:crypto';

import {
  DocumentsClient,
  DocumentsUnavailable,
  type IssuedDocument,
  type IssuedDocumentFacts,
  type IssueDocumentRequest,
  type RevocationReason,
  type UploadDownload,
} from '../../src/documents/documents-client.js';
import { InternalApiRejected } from '../../src/internal-api/rejected.js';

/**
 * How the fake documents service pulls a document's fields (a letter's, a referral package's), as
 * the real one would over HTTP.
 */
export type PayloadSource = (
  tenant: string,
  document: IssueDocumentRequest,
) => Promise<{ status: number; body: unknown }>;

export interface IssuedLetter {
  request: IssueDocumentRequest;
  tenant: string;
  /** What the pull of the letter payload answered when the letter was rendered. */
  pulled: { status: number; body: unknown };
  document: IssuedDocument;
  /** SHA-256 of the "signed PDF": derived from the document id, stable for assertions. */
  sha256: string;
}

/** An upload as the fake documents service holds it. */
export interface FakeUpload {
  tenant: string;
  purpose: string;
  state: 'clean' | 'infected' | 'pending';
  fileName: string | null;
  sha256: string;
}

/**
 * The documents internal API for tests: uploads per Commission, and a record of every download
 * link issued (which upload, for which Commission) and every document revoked. Each document
 * issued pulls the letter payload by the record it names (clarification or determination) from the
 * review service (as documents does when it renders the template) and records what it got.
 */
export class FakeDocuments extends DocumentsClient {
  readonly downloads: { uploadId: string; tenant: string }[] = [];
  readonly issued: IssuedLetter[] = [];
  readonly revoked: { documentId: string; tenant: string; reason: RevocationReason }[] = [];
  payloadSource: PayloadSource | undefined;
  /** Every document the Commission issued, through `issue` or given, by id. */
  private readonly known = new Map<string, { tenant: string; type: string; sha256: string }>();
  private readonly uploads = new Map<string, FakeUpload>();
  private failures = 0;
  private refusals = 0;

  /** Clean declaration attachments of `tenant`. */
  givenUploads(tenant: string, ...uploadIds: string[]): void {
    for (const uploadId of uploadIds) this.givenUpload(uploadId, { tenant });
  }

  /** One upload; clean, a declaration attachment, unless said otherwise. */
  givenUpload(uploadId: string, upload: Partial<FakeUpload> & { tenant: string }): void {
    this.uploads.set(uploadId, {
      purpose: 'declaration-attachment',
      state: 'clean',
      fileName: `${uploadId.slice(0, 8)}.pdf`,
      sha256: uploadId.replaceAll('-', '').padEnd(64, '0').slice(0, 64),
      ...upload,
    });
  }

  /**
   * A document the Commission issued before the test (a letter arranged directly in the review
   * database); `getIssuedDocument` then knows it. Returns its SHA-256.
   */
  givenIssuedDocument(
    tenant: string,
    documentId: string,
    type: IssueDocumentRequest['type'],
  ): string {
    const sha256 = fakeDocumentSha256(documentId);
    this.known.set(documentId, { tenant, type, sha256 });
    return sha256;
  }

  /** The next `count` calls fail, as a documents outage would. */
  failCalls(count: number): void {
    this.failures = count;
  }

  /** The next `count` documents asked for are refused (422), as documents refuses a bad request. */
  refuseIssues(count: number): void {
    this.refusals = count;
  }

  reset(): void {
    this.refusals = 0;
    this.downloads.length = 0;
    this.issued.length = 0;
    this.known.clear();
    this.revoked.length = 0;
    this.uploads.clear();
    this.failures = 0;
  }

  getUploadDownload(uploadId: string, tenant: string): Promise<UploadDownload | null> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new DocumentsUnavailable('The documents service is unreachable'));
    }
    const upload = this.uploads.get(uploadId);
    if (upload?.tenant !== tenant) return Promise.resolve(null);
    if (upload.state !== 'clean') {
      return Promise.reject(new InternalApiRejected('documents', 409));
    }
    this.downloads.push({ uploadId, tenant });
    return Promise.resolve({
      downloadUrl: `https://objects.test/uploads/${uploadId}?signature=test`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      purpose: upload.purpose,
      fileName: upload.fileName,
      sha256: upload.sha256,
    });
  }

  revoke(documentId: string, tenant: string, reason: RevocationReason): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new DocumentsUnavailable('The documents service is unreachable'));
    }
    if (!this.revoked.some((revocation) => revocation.documentId === documentId)) {
      this.revoked.push({ documentId, tenant, reason });
    }
    return Promise.resolve();
  }

  async issue(request: IssueDocumentRequest, tenant: string): Promise<IssuedDocument> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new DocumentsUnavailable('The documents service is unreachable');
    }
    if (this.refusals > 0) {
      this.refusals -= 1;
      throw new InternalApiRejected('documents', 422);
    }
    if (!this.payloadSource) throw new Error('No payload source for the fake documents service');
    const pulled = await this.payloadSource(tenant, request);
    if (pulled.status !== 200) {
      throw new DocumentsUnavailable(`The payload pull answered ${String(pulled.status)}`);
    }
    const document = {
      id: randomUUID(),
      verificationId: `ADL-${randomUUID().slice(0, 4).toUpperCase()}-TEST`,
    };
    const sha256 = fakeDocumentSha256(document.id);
    this.issued.push({ request: structuredClone(request), tenant, pulled, document, sha256 });
    this.known.set(document.id, { tenant, type: request.type, sha256 });
    return document;
  }

  getIssuedDocument(documentId: string, tenant: string): Promise<IssuedDocumentFacts | null> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new DocumentsUnavailable('The documents service is unreachable'));
    }
    const found = this.known.get(documentId);
    if (found?.tenant !== tenant) return Promise.resolve(null);
    return Promise.resolve({ id: documentId, type: found.type, sha256: found.sha256 });
  }
}

/** The SHA-256 the fake gives an issued document. */
export function fakeDocumentSha256(documentId: string): string {
  return createHash('sha256').update(`document:${documentId}`).digest('hex');
}
