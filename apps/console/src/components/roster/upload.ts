import type { DocumentsResult, Upload, UploadReservation } from '../../server/documents/client';
import type { CreateRosterUploadInput } from '../../server/uploads';
import { rosterContentType } from './roster-file';

/** How a presigned PUT ended. */
export type PutResult = 'ok' | 'failed' | 'aborted';

export interface PutFileOptions {
  signal?: AbortSignal;
  /** Bytes sent so far and in total, as the browser reports them. */
  onProgress?: (loaded: number, total: number) => void;
  /** For tests. */
  createXhr?: () => XMLHttpRequest;
}

/**
 * PUTs `body` straight to a presigned object storage URL, reporting upload progress (which
 * `fetch` cannot) and stopping when `signal` aborts. Sends `contentType`, which the URL is
 * signed for. Resolves to how it ended; never rejects. Any non-2xx answer, including an
 * expired signature (403), is a failure.
 */
export function putFile(
  url: string,
  body: Blob,
  contentType: string,
  { signal, onProgress, createXhr = () => new XMLHttpRequest() }: PutFileOptions = {},
): Promise<PutResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve('aborted');
      return;
    }
    const xhr = createXhr();
    const abort = () => {
      xhr.abort();
    };
    const settle = (result: PutResult) => {
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      settle(xhr.status >= 200 && xhr.status < 300 ? 'ok' : 'failed');
    };
    xhr.onerror = () => {
      settle('failed');
    };
    xhr.ontimeout = () => {
      settle('failed');
    };
    xhr.onabort = () => {
      settle('aborted');
    };
    signal?.addEventListener('abort', abort);
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.send(body);
  });
}

/** A roster file that passed the scan and sits in the clean bucket, ready to import. */
export interface CleanUpload {
  id: string;
  fileName: string;
  size: number;
}

/**
 * Why the documents service refused a file for good: not a CSV or XLSX file, a CSV not saved as
 * UTF-8, or too big.
 */
export type UploadRejectionReason = 'type' | 'encoding' | 'size';

/** How uploading a roster file ended. */
export type UploadOutcome =
  | { kind: 'clean'; upload: CleanUpload }
  | { kind: 'infected' }
  | { kind: 'rejected'; reason: UploadRejectionReason }
  /** Expired, interrupted, missing, timed out or refused: worth trying again. */
  | { kind: 'failed' }
  | { kind: 'unauthenticated' }
  | { kind: 'aborted' };

export interface UploadDeps {
  createUpload: (input: CreateRosterUploadInput) => Promise<DocumentsResult<UploadReservation>>;
  putFile: typeof putFile;
  completeUpload: (id: string) => Promise<DocumentsResult<Upload>>;
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
  const failed = (result: DocumentsResult<unknown>): UploadOutcome =>
    !result.ok && result.error.kind === 'unauthenticated'
      ? { kind: 'unauthenticated' }
      : { kind: 'failed' };

  const reservation = await deps
    .createUpload({ contentType, declaredSize: file.size, fileName: file.name })
    .catch(() => null);
  if (signal?.aborted) return { kind: 'aborted' };
  if (!reservation) return { kind: 'failed' };
  if (!reservation.ok) return failed(reservation);

  events.onUploading?.();
  let lastPercent = -1;
  const put = await deps.putFile(reservation.data.uploadUrl, file, contentType, {
    signal,
    onProgress: (loaded, total) => {
      const percent = total > 0 ? Math.floor((loaded / total) * 100) : 0;
      if (percent === lastPercent) return;
      lastPercent = percent;
      events.onProgress?.(percent);
    },
  });
  if (put === 'aborted' || signal?.aborted) return { kind: 'aborted' };
  if (put === 'failed') return { kind: 'failed' };

  events.onScanning?.();
  const completed = await deps.completeUpload(reservation.data.id).catch(() => null);
  if (signal?.aborted) return { kind: 'aborted' };
  if (!completed) return { kind: 'failed' };
  if (!completed.ok) return failed(completed);
  return outcomeOf(completed.data, file);
}
