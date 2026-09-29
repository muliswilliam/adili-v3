import { randomUUID } from 'node:crypto';

import {
  DocumentsClient,
  DocumentsUnavailable,
  type IssuedDocument,
  type IssueDocumentRequest,
  type UploadDownload,
} from '../../src/documents/documents-client.js';

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

/**
 * The documents internal API for tests: clean uploads per Commission, and a record of every
 * download link issued (which upload, for which Commission). Each document issued pulls the
 * letter payload by clarification id from the review service (as documents does when it renders
 * the template) and records what it got.
 */
export class FakeDocuments extends DocumentsClient {
  readonly downloads: { uploadId: string; tenant: string }[] = [];
  readonly issued: IssuedLetter[] = [];
  payloadSource: PayloadSource | undefined;
  private readonly uploads = new Map<string, string>();
  private failures = 0;

  /** Clean uploads of `tenant`. */
  givenUploads(tenant: string, ...uploadIds: string[]): void {
    for (const uploadId of uploadIds) this.uploads.set(uploadId, tenant);
  }

  /** The next `count` calls fail, as a documents outage would. */
  failCalls(count: number): void {
    this.failures = count;
  }

  reset(): void {
    this.downloads.length = 0;
    this.issued.length = 0;
    this.uploads.clear();
    this.failures = 0;
  }

  getUploadDownload(uploadId: string, tenant: string): Promise<UploadDownload | null> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new DocumentsUnavailable('The documents service is unreachable'));
    }
    if (this.uploads.get(uploadId) !== tenant) return Promise.resolve(null);
    this.downloads.push({ uploadId, tenant });
    return Promise.resolve({
      downloadUrl: `https://objects.test/uploads/${uploadId}?signature=test`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
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
