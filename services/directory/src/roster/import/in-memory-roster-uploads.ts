import { randomUUID } from 'node:crypto';

import type { RosterFileFormat } from '../roster-file.js';
import {
  DocumentsUnavailable,
  type OpenedRosterUpload,
  type RosterUpload,
  RosterUploads,
  UploadNotClean,
  UploadNotFound,
} from './roster-uploads.js';

interface StoredUpload {
  tenant: string;
  upload: RosterUpload;
  bytes: Uint8Array;
  clean: boolean;
}

/** Roster uploads held in memory, for tests. Mirrors the documents service's answers. */
export class InMemoryRosterUploads extends RosterUploads {
  private readonly uploads = new Map<string, StoredUpload>();
  private failures = 0;

  /** Stores a clean upload of `tenant` and returns its id. */
  add(
    tenant: string,
    file: { bytes: Uint8Array | string; format?: RosterFileFormat; fileName?: string | null },
  ): string {
    const id = randomUUID();
    const bytes =
      typeof file.bytes === 'string' ? new TextEncoder().encode(file.bytes) : file.bytes;
    const format = file.format ?? 'csv';
    this.uploads.set(id, {
      tenant,
      upload: {
        id,
        fileName: file.fileName === undefined ? `roster.${format}` : file.fileName,
        format,
        size: bytes.byteLength,
      },
      bytes,
      clean: true,
    });
    return id;
  }

  /** Stores an upload that is not clean (e.g. infected) and returns its id. */
  addNotClean(tenant: string): string {
    const id = this.add(tenant, { bytes: '' });
    const stored = this.uploads.get(id);
    if (stored) stored.clean = false;
    return id;
  }

  /** The next `count` calls fail with `DocumentsUnavailable`. */
  failNext(count = 1): void {
    this.failures = count;
  }

  reset(): void {
    this.uploads.clear();
    this.failures = 0;
  }

  describe(tenant: string, uploadId: string): Promise<RosterUpload> {
    return Promise.resolve().then(() => this.find(tenant, uploadId).upload);
  }

  open(tenant: string, uploadId: string): Promise<OpenedRosterUpload> {
    return Promise.resolve().then(() => {
      const stored = this.find(tenant, uploadId);
      return { ...stored.upload, body: chunked(stored.bytes) };
    });
  }

  private find(tenant: string, uploadId: string): StoredUpload {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new DocumentsUnavailable('The documents service is unreachable (simulated)');
    }
    const stored = this.uploads.get(uploadId);
    if (stored?.tenant !== tenant) throw new UploadNotFound(uploadId);
    if (!stored.clean) throw new UploadNotClean(uploadId);
    return stored;
  }
}

/** Yields the bytes in 64 KiB chunks, like a network stream. */
async function* chunked(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  const size = 64 * 1024;
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    await Promise.resolve();
    yield bytes.subarray(offset, offset + size);
  }
}
