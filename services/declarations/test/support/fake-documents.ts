import { createHash, randomUUID } from 'node:crypto';

import {
  type CleanUpload,
  DECLARATION_ATTACHMENT_PURPOSE,
  DocumentsClient,
  DocumentsUnavailable,
  UploadNotClean,
  UploadNotFound,
} from '../../src/documents/documents-client.js';

/** An upload as the documents service holds it, in any state. */
export interface FakeUpload extends CleanUpload {
  tenant: string;
  state: 'awaiting-upload' | 'clean' | 'infected' | 'rejected';
}

/** A clean declaration attachment of the Commission reserved by `uploadedBy`, unless overridden. */
export function upload(
  tenant: string,
  uploadedBy: string,
  overrides: Partial<FakeUpload> = {},
): FakeUpload {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    tenant,
    uploadedBy,
    state: 'clean',
    purpose: DECLARATION_ATTACHMENT_PURPOSE,
    fileName: 'title-deed.pdf',
    sha256: createHash('sha256').update(id).digest('hex'),
    size: 482_113,
    ...overrides,
  };
}

/**
 * The documents internal uploads API for tests: answers only for the acting Commission's uploads
 * (404 otherwise, as documents does) and only for clean ones (409). `linked` and `unlinked` list
 * the uploads whose link was recorded or taken back, as `<tenant> <uploadId>`; `unavailable`
 * makes every call fail, and `markLinkedUnavailable` only the call that records a link.
 * `whileAnswering` runs before each answer, to look at what the caller holds while it waits on
 * documents.
 */
export class FakeDocuments extends DocumentsClient {
  readonly linked: string[] = [];
  readonly unlinked: string[] = [];
  unavailable = false;
  markLinkedUnavailable = false;
  whileAnswering: (() => Promise<void>) | null = null;
  private readonly uploads = new Map<string, FakeUpload>();

  givenUploads(...uploads: FakeUpload[]): void {
    for (const upload of uploads) this.uploads.set(upload.id, upload);
  }

  reset(): void {
    this.linked.length = 0;
    this.unlinked.length = 0;
    this.unavailable = false;
    this.markLinkedUnavailable = false;
    this.whileAnswering = null;
    this.uploads.clear();
  }

  getCleanUpload(tenant: string, uploadId: string): Promise<CleanUpload> {
    return this.answer(tenant, uploadId, ({ id, purpose, uploadedBy, fileName, sha256, size }) => ({
      id,
      purpose,
      uploadedBy,
      fileName,
      sha256,
      size,
    }));
  }

  markLinked(tenant: string, uploadId: string): Promise<void> {
    if (this.markLinkedUnavailable) {
      return Promise.reject(new DocumentsUnavailable('The documents service did not answer'));
    }
    return this.answer(tenant, uploadId, () => {
      this.linked.push(`${tenant} ${uploadId}`);
    });
  }

  markUnlinked(tenant: string, uploadId: string): Promise<void> {
    if (this.unavailable) {
      return Promise.reject(new DocumentsUnavailable('The documents service did not answer'));
    }
    if (this.uploads.get(uploadId)?.tenant !== tenant) {
      return Promise.reject(new UploadNotFound(uploadId));
    }
    this.unlinked.push(`${tenant} ${uploadId}`);
    return Promise.resolve();
  }

  private async answer<T>(
    tenant: string,
    uploadId: string,
    clean: (upload: FakeUpload) => T,
  ): Promise<T> {
    await this.whileAnswering?.();
    if (this.unavailable) {
      return Promise.reject(new DocumentsUnavailable('The documents service did not answer'));
    }
    const upload = this.uploads.get(uploadId);
    if (upload?.tenant !== tenant) return Promise.reject(new UploadNotFound(uploadId));
    if (upload.state !== 'clean') return Promise.reject(new UploadNotClean(uploadId));
    return Promise.resolve(clean(upload));
  }
}
