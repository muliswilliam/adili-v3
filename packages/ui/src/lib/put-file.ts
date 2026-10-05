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
 *
 * The browser half of every documents upload (Spec 02): the BFF reserves the upload
 * (`POST /v1/uploads`), this sends the bytes, and the BFF then completes it
 * (`POST /v1/uploads/{id}/complete`).
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

/**
 * An `onProgress` for `putFile` that reports whole percents to `onPercent`, each once. Rounds
 * down, so 100 means every byte is sent.
 */
export function wholePercents(
  onPercent: (percent: number) => void,
): NonNullable<PutFileOptions['onProgress']> {
  let last = -1;
  return (loaded, total) => {
    const percent = total > 0 ? Math.floor((loaded / total) * 100) : 0;
    if (percent === last) return;
    last = percent;
    onPercent(percent);
  };
}
