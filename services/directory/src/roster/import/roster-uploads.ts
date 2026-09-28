import type { RosterFileFormat } from '../roster-file.js';

/** An upload read on behalf of a tenant: documents answers only for the tenant's own uploads. */
export interface UploadRef {
  tenant: string;
  uploadId: string;
}

/** A clean roster upload as the documents service describes it. */
export interface RosterUpload {
  id: string;
  /** Name of the file as uploaded; display only. */
  fileName: string | null;
  format: RosterFileFormat;
  /** Bytes. */
  size: number;
}

export interface OpenedRosterUpload extends RosterUpload {
  /** The file's bytes, streamed. Iterate once. */
  body: AsyncIterable<Uint8Array>;
}

/**
 * The tenant has no roster upload with this id: unknown, another tenant's, or uploaded for
 * another purpose.
 */
export class UploadNotFound extends Error {
  constructor(readonly uploadId: string) {
    super(`No roster upload ${uploadId} for this Commission`);
    this.name = 'UploadNotFound';
  }
}

/** The upload exists but is not clean (still awaiting its bytes, infected, rejected, expired). */
export class UploadNotClean extends Error {
  constructor(readonly uploadId: string) {
    super(`Upload ${uploadId} is not clean`);
    this.name = 'UploadNotClean';
  }
}

/** The documents service or object storage did not answer, or answered garbage. Retry later. */
export class DocumentsUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DocumentsUnavailable';
  }
}

/**
 * Roster files uploaded to the documents service (ADR-002), read on behalf of a tenant. The
 * directory never holds storage credentials: documents hands out a short-lived download URL for
 * a clean upload, and the file is streamed from it (one synchronous hop, ADR-013).
 *
 * Abstract class rather than interface so it doubles as the Nest injection token; the HTTP
 * adapter serves the service, the in-memory one the tests.
 */
export abstract class RosterUploads {
  /**
   * The upload's metadata. Throws `UploadNotFound`, `UploadNotClean` or `DocumentsUnavailable`.
   */
  abstract describe(ref: UploadRef): Promise<RosterUpload>;

  /** The upload's metadata and bytes. Throws like `describe`. */
  abstract open(ref: UploadRef): Promise<OpenedRosterUpload>;
}

const FORMATS: Record<string, RosterFileFormat> = {
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/** The roster file format of a detected content type, or undefined for anything else. */
export function rosterFormatOf(contentType: string): RosterFileFormat | undefined {
  return FORMATS[contentType];
}
