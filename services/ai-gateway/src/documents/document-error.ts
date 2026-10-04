/** Why the gateway could not read a document a task reads (spec 05b). */
export type DocumentErrorKind =
  /** Not fetched: the link expired or the store did not answer. */
  | 'unavailable'
  /** Not the file the request names: another SHA-256. */
  | 'mismatch'
  /** Damaged, or not a PDF or image. */
  | 'unreadable'
  /** More pages or bytes than a reading takes. */
  | 'too-large';

/** A document the gateway cannot read; the job fails, and the message names no content. */
export class DocumentError extends Error {
  override readonly name = 'DocumentError';
  constructor(
    readonly kind: DocumentErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
