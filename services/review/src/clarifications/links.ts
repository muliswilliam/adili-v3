import { config } from '../config.js';

/** A page of the declarant portal. */
export const portal = (path: string) => new URL(path, config.PORTAL_URL.replace(/\/?$/, '/')).href;

/** The portal page where the declarant reads and answers a clarification. */
export function portalClarificationUrl(clarificationId: string): string {
  return portal(`clarifications/${clarificationId}`);
}

/**
 * Where the portal serves an issued letter to its owner: a portal route proxying the documents
 * service's owner-only download (`getDocumentDownload`, subject person only).
 */
export function letterDownloadUrl(documentId: string): string {
  return portal(`api/documents/${documentId}/download`);
}
