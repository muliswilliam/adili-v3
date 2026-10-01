import { randomUUID } from 'node:crypto';

import {
  DocumentsClient,
  DocumentsUnavailable,
  type IssuedDocument,
  type IssueDocumentRequest,
  type RevocationReason,
  type UploadDownload,
} from '../../src/documents/documents-client.js';
import { InternalApiRejected } from '../../src/internal-api/rejected.js';

/** How the fake documents service pulls a letter's fields, as the real one would over HTTP. */
export type PayloadSource = (
  tenant: string,
  clarificationId: string,
) => Promise<{ status: number; body: unknown }>;

export interface IssuedLetter {
  request: IssueDocumentRequest;
  /** What the pull of the letter payload answered when the letter was rendered. */
  pulled: { status: number; body: unknown };
  document: IssuedDocument;
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
 * issued pulls the letter payload by clarification id from the review service (as documents does
 * when it renders the template) and records what it got.
 */
export class FakeDocuments extends DocumentsClient {
  readonly downloads: { uploadId: string; tenant: string }[] = [];
  readonly issued: IssuedLetter[] = [];
  readonly revoked: { documentId: string; tenant: string; reason: RevocationReason }[] = [];
  payloadSource: PayloadSource | undefined;
  private readonly uploads = new Map<string, FakeUpload>();
  private failures = 0;

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

  /** The next `count` calls fail, as a documents outage would. */
  failCalls(count: number): void {
    this.failures = count;
  }

  reset(): void {
    this.downloads.length = 0;
    this.issued.length = 0;
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

  async issue(request: IssueDocumentRequest): Promise<IssuedDocument> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new DocumentsUnavailable('The documents service is unreachable');
    }
    if (!this.payloadSource) throw new Error('No payload source for the fake documents service');
    const pulled = await this.payloadSource(request.issuerTenant, request.payload.clarificationId);
    if (pulled.status !== 200) {
      throw new DocumentsUnavailable(`The payload pull answered ${String(pulled.status)}`);
    }
    const document = {
      id: randomUUID(),
      verificationId: `ADL-${randomUUID().slice(0, 4).toUpperCase()}-TEST`,
    };
    this.issued.push({ request: structuredClone(request), pulled, document });
    return document;
  }
}
