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

/**
 * Starts a download from a short-lived link that answers with an attachment (a presigned URL):
 * the browser saves the file and the page stays. Every link-based download in the console goes
 * through here (or `pendingTab`), so tests replace one module.
 */
export function downloadFrom(url: string): void {
  window.location.assign(url);
}

/** A tab opened in the click, pointed at its link once that comes back. */
export interface PendingTab {
  show: (url: string) => void;
  close: () => void;
}

/**
 * Opens a new tab in the click, for a document to read or print whose link is fetched first:
 * opening it later, after the fetch, the browser blocks it as a pop-up. `show` points the tab at
 * the link (cut off from this page), or opens the link here when the tab was blocked anyway.
 */
export function pendingTab(): PendingTab {
  const tab = window.open('', '_blank');
  return {
    show(url) {
      if (!tab) {
        window.location.assign(url);
        return;
      }
      tab.opener = null;
      tab.location.href = url;
    },
    close() {
      tab?.close();
    },
  };
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
