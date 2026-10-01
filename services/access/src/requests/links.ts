import { config } from '../config.js';

/**
 * Where the access service's messages send their recipients to sign in: the portal for
 * applicants and declarants, the console for access officers. The pages are the front ends'.
 */

/** The applicant's requests in the portal (spec 10 FE-3). */
export function applicantRequestsUrl(): string {
  return new URL('/access/requests', config.PORTAL_URL).toString();
}

/** The declarant's access notices in the portal, where they respond (spec 10 FE-4). */
export function declarantNoticesUrl(): string {
  return new URL('/access/notices', config.PORTAL_URL).toString();
}

/** One request in the access officer's workspace in the console (spec 10 FE-5). */
export function officerRequestUrl(requestId: string): string {
  return new URL(`/access/requests/${requestId}`, config.CONSOLE_URL).toString();
}
