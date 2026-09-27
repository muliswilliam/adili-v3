import { type Download, downloadAttachment, type DownloadDeps } from '../download';

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

/**
 * Downloads the roster template through the console and saves it under the file name the
 * directory gave it. Resolves to what happened, so the caller can say so; never rejects.
 */
export function downloadRosterTemplate(
  format: RosterTemplateFormat,
  deps?: DownloadDeps,
): Promise<Download> {
  return downloadAttachment(rosterTemplateUrl(format), `adili-roster-template.${format}`, deps);
}
