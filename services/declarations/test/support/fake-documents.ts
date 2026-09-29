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

/** A clean declaration attachment of the Commission, unless overridden. */
export function upload(tenant: string, overrides: Partial<FakeUpload> = {}): FakeUpload {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    tenant,
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
 * (404 otherwise, as documents does) and only for clean ones (409). `linked` lists the uploads
 * whose link was recorded, as `<tenant> <uploadId>`; `unavailable` makes every call fail.
 */
export class FakeDocuments extends DocumentsClient {
  readonly linked: string[] = [];
  unavailable = false;
  private readonly uploads = new Map<string, FakeUpload>();

  givenUploads(...uploads: FakeUpload[]): void {
    for (const upload of uploads) this.uploads.set(upload.id, upload);
  }

  reset(): void {
    this.linked.length = 0;
    this.unavailable = false;
    this.uploads.clear();
  }

  getCleanUpload(tenant: string, uploadId: string): Promise<CleanUpload> {
    return this.answer(tenant, uploadId, ({ id, purpose, fileName, sha256, size }) => ({
      id,
      purpose,
      fileName,
      sha256,
      size,
    }));
  }

  markLinked(tenant: string, uploadId: string): Promise<void> {
    return this.answer(tenant, uploadId, () => {
      this.linked.push(`${tenant} ${uploadId}`);
    });
  }

  private answer<T>(
    tenant: string,
    uploadId: string,
    clean: (upload: FakeUpload) => T,
  ): Promise<T> {
    if (this.unavailable) {
      return Promise.reject(new DocumentsUnavailable('The documents service did not answer'));
    }
    const upload = this.uploads.get(uploadId);
    if (upload?.tenant !== tenant) return Promise.reject(new UploadNotFound(uploadId));
    if (upload.state !== 'clean') return Promise.reject(new UploadNotClean(uploadId));
    return Promise.resolve(clean(upload));
  }
}
