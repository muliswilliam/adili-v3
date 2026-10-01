import type { Logger } from '@nestjs/common';

/** The upload purpose a declaration attachment must have been uploaded for (spec 05). */
export const DECLARATION_ATTACHMENT_PURPOSE = 'declaration-attachment';

/** A clean upload as the documents service describes it: what an attachment keeps of it. */
export interface CleanUpload {
  id: string;
  /** The purpose it was uploaded for, e.g. `declaration-attachment`. */
  purpose: string;
  /** Token subject (`sub`) of the caller who reserved it. */
  uploadedBy: string;
  /** Name of the file as uploaded; display only. Null when the uploader gave none. */
  fileName: string | null;
  /** Hex SHA-256 of the clean object. */
  sha256: string;
  /** Bytes. */
  size: number;
}

/** The Commission has no upload with this id: unknown, or another Commission's. */
export class UploadNotFound extends Error {
  constructor(readonly uploadId: string) {
    super(`No upload ${uploadId} for this Commission`);
    this.name = 'UploadNotFound';
  }
}

/** The upload exists but is not clean (awaiting its bytes, infected, rejected, expired). */
export class UploadNotClean extends Error {
  constructor(readonly uploadId: string) {
    super(`Upload ${uploadId} is not clean`);
    this.name = 'UploadNotClean';
  }
}

/** The documents service is unreachable, refused the service's token, or answered off contract. */
export class DocumentsUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DocumentsUnavailable';
  }
}

/**
 * The documents service's internal uploads API as declaration attachments need it (ADR-002: the
 * bytes stay there), acting for a Commission. A Nest token: the service uses
 * `HttpDocumentsClient`, tests a fake.
 */
export abstract class DocumentsClient {
  /**
   * The Commission's clean upload. Throws `UploadNotFound`, `UploadNotClean` or
   * `DocumentsUnavailable`.
   */
  abstract getCleanUpload(tenant: string, uploadId: string): Promise<CleanUpload>;

  /**
   * Records that the upload is linked, so the documents orphan sweep keeps it. Idempotent.
   * Throws like `getCleanUpload`.
   */
  abstract markLinked(tenant: string, uploadId: string): Promise<void>;

  /**
   * Records that the link is gone, so the orphan sweep deletes the object 30 days on.
   * Idempotent. Throws `UploadNotFound` or `DocumentsUnavailable`.
   */
  abstract markUnlinked(tenant: string, uploadId: string): Promise<void>;
}

/**
 * Tells documents the uploads are no longer linked, once the change that unlinked them is
 * committed, so its orphan sweep deletes the objects. Best effort: the unlink stands either way,
 * and an upload documents was not told about stays marked linked (kept, never swept).
 */
export async function releaseUploads(
  documents: DocumentsClient,
  logger: Pick<Logger, 'warn'>,
  tenant: string,
  uploadIds: readonly string[],
): Promise<void> {
  const results = await Promise.allSettled(
    uploadIds.map((uploadId) => documents.markUnlinked(tenant, uploadId)),
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.warn(
        { err: result.reason as unknown, tenant, uploadId: uploadIds[index] },
        'Documents was not told an upload is unlinked; it stays marked linked',
      );
    }
  });
}
