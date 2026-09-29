import {
  DocumentsClient,
  DocumentsUnavailable,
  type UploadDownload,
} from '../../src/documents/documents-client.js';

/**
 * The documents internal API for tests: clean uploads per Commission, and a record of every
 * download link issued (which upload, for which Commission).
 */
export class FakeDocuments extends DocumentsClient {
  readonly downloads: { uploadId: string; tenant: string }[] = [];
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
}
