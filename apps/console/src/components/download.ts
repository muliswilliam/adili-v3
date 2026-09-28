/** The file name a `Content-Disposition: attachment; filename="…"` header gives, or `fallback`. */
export function attachmentFileName(disposition: string | null, fallback: string): string {
  const name =
    disposition?.match(/filename="([^"]+)"/)?.[1] ?? disposition?.match(/filename=([^;\s]+)/)?.[1];
  return name ?? fallback;
}

export type Download = 'saved' | 'unauthenticated' | 'failed';

export interface DownloadDeps {
  fetch: typeof fetch;
  /** Hands the file to the browser's download (see `saveFile`). */
  save: (file: Blob, fileName: string) => void;
}

/**
 * Downloads a file from one of the console's own routes and saves it under the file name its
 * `Content-Disposition` gives, else `fallbackName`. Resolves to what happened, so the caller can
 * say so; never rejects.
 */
export async function downloadAttachment(
  url: string,
  fallbackName: string,
  { fetch: fetchImpl, save }: DownloadDeps = { fetch, save: saveFile },
): Promise<Download> {
  try {
    const response = await fetchImpl(url);
    if (response.status === 401) return 'unauthenticated';
    if (!response.ok) return 'failed';
    const fileName = attachmentFileName(response.headers.get('content-disposition'), fallbackName);
    save(await response.blob(), fileName);
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** Saves `file` as a download named `fileName`, as a link with `download` would. */
export function saveFile(file: Blob, fileName: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke after the click has been handled; revoking at once can cancel the download.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
