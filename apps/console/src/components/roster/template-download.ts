/** File formats of the roster template (`getRosterTemplate` in the directory contract). */
export const ROSTER_TEMPLATE_FORMATS = ['csv', 'xlsx'] as const;
export type RosterTemplateFormat = (typeof ROSTER_TEMPLATE_FORMATS)[number];

export function isRosterTemplateFormat(value: unknown): value is RosterTemplateFormat {
  return ROSTER_TEMPLATE_FORMATS.some((format) => format === value);
}

/** The console's own route that fetches the template for the signed-in user (a server route). */
export function rosterTemplateUrl(format: RosterTemplateFormat): string {
  return `/roster/template?format=${format}`;
}

/** The file name a `Content-Disposition: attachment; filename="…"` header gives, or `fallback`. */
export function attachmentFileName(disposition: string | null, fallback: string): string {
  const name =
    disposition?.match(/filename="([^"]+)"/)?.[1] ?? disposition?.match(/filename=([^;\s]+)/)?.[1];
  return name ?? fallback;
}

export type TemplateDownload = 'saved' | 'unauthenticated' | 'failed';

export interface TemplateDownloadDeps {
  fetch: typeof fetch;
  /** Hands the file to the browser's download (see `saveFile`). */
  save: (file: Blob, fileName: string) => void;
}

/**
 * Downloads the roster template through the console and saves it under the file name the
 * directory gave it. Resolves to what happened, so the caller can say so; never rejects.
 */
export async function downloadRosterTemplate(
  format: RosterTemplateFormat,
  { fetch: fetchImpl, save }: TemplateDownloadDeps = { fetch, save: saveFile },
): Promise<TemplateDownload> {
  try {
    const response = await fetchImpl(rosterTemplateUrl(format));
    if (response.status === 401) return 'unauthenticated';
    if (!response.ok) return 'failed';
    const fileName = attachmentFileName(
      response.headers.get('content-disposition'),
      `adili-roster-template.${format}`,
    );
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
