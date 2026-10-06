import { type putFile, wholePercents } from '@adili/ui';

import type { DocumentsResult, Upload, UploadReservation } from '../../server/documents/client';
import type { CreateRosterUploadInput } from '../../server/uploads';
import { rosterContentType } from './roster-file';

/** A roster file that passed the scan and sits in the clean bucket, ready to import. */
export interface CleanUpload {
  id: string;
  fileName: string;
  size: number;
}

/**
 * Why a file was refused for good: not a CSV or XLSX file, a CSV not saved as UTF-8, or too big
 * (the documents service says so); or empty (refused before any request: the service reserves
 * no upload of 0 bytes, #713).
 */
export type UploadRejectionReason = 'type' | 'encoding' | 'size' | 'empty';

/** How uploading a roster file ended. */
export type UploadOutcome =
  | { kind: 'clean'; upload: CleanUpload }
  | { kind: 'infected' }
  | { kind: 'rejected'; reason: UploadRejectionReason }
  /** Expired, interrupted, missing, timed out or refused: worth trying again. */
  | { kind: 'failed' }
  | { kind: 'unauthenticated' }
  | { kind: 'aborted' };

/** Each call names its Idempotency-Key: one per logical request, reused if it is retried. */
export interface UploadDeps {
  createUpload: (
    input: CreateRosterUploadInput,
    idempotencyKey: string,
  ) => Promise<DocumentsResult<UploadReservation>>;
  putFile: typeof putFile;
  completeUpload: (id: string, idempotencyKey: string) => Promise<DocumentsResult<Upload>>;
  /** New Idempotency-Keys; `crypto.randomUUID` in the app. */
  newKey?: () => string;
}

export interface UploadEvents {
  /** The reservation is made and the bytes start going up. */
  onUploading?: () => void;
  /** Whole percent of the bytes sent. */
  onProgress?: (percent: number) => void;
  /** Every byte is up; the documents service is checking the file. */
  onScanning?: () => void;
}

/** The outcome a completed upload's final state stands for. */
export function outcomeOf(upload: Upload, file: Pick<File, 'name' | 'size'>): UploadOutcome {
  switch (upload.state) {
    case 'clean':
      return {
        kind: 'clean',
        upload: {
          id: upload.id,
          fileName: upload.fileName ?? file.name,
          size: upload.size ?? file.size,
        },
      };
    case 'infected':
      return { kind: 'infected' };
    case 'rejected':
      return upload.rejection === 'type' ||
        upload.rejection === 'encoding' ||
        upload.rejection === 'size'
        ? { kind: 'rejected', reason: upload.rejection }
        : { kind: 'failed' };
    default:
      return { kind: 'failed' };
  }
}

/**
 * Uploads a roster file end to end: reserve an upload, PUT the bytes to the presigned URL with
 * progress, then complete it, which scans the file. Resolves to the outcome; never rejects.
 * Aborting `signal` stops the PUT; a completion already sent runs on and is ignored.
 */
export async function uploadRosterFile(
  file: File,
  deps: UploadDeps,
  { signal, ...events }: UploadEvents & { signal?: AbortSignal } = {},
): Promise<UploadOutcome> {
  const contentType = rosterContentType(file.name);
  if (!contentType) return { kind: 'rejected', reason: 'type' };
  if (file.size === 0) return { kind: 'rejected', reason: 'empty' };
  const failed = (result: DocumentsResult<unknown>): UploadOutcome =>
    !result.ok && result.error.kind === 'unauthenticated'
      ? { kind: 'unauthenticated' }
      : { kind: 'failed' };

  const newKey = deps.newKey ?? (() => crypto.randomUUID());
  const reservation = await deps
    .createUpload({ contentType, declaredSize: file.size, fileName: file.name }, newKey())
    .catch(() => null);
  if (signal?.aborted) return { kind: 'aborted' };
  if (!reservation) return { kind: 'failed' };
  if (!reservation.ok) return failed(reservation);

  events.onUploading?.();
  const put = await deps.putFile(reservation.data.uploadUrl, file, contentType, {
    signal,
    onProgress: wholePercents((percent) => events.onProgress?.(percent)),
  });
  if (put === 'aborted' || signal?.aborted) return { kind: 'aborted' };
  if (put === 'failed') return { kind: 'failed' };

  events.onScanning?.();
  const completed = await deps.completeUpload(reservation.data.id, newKey()).catch(() => null);
  if (signal?.aborted) return { kind: 'aborted' };
  if (!completed) return { kind: 'failed' };
  if (!completed.ok) return failed(completed);
  return outcomeOf(completed.data, file);
}
