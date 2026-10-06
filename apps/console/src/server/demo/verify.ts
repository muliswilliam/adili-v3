/**
 * The verify statuses the demo seeds a document in (#620), in the order the demo panel lists
 * them, with how the panel names each (the verify app's own words).
 */
export const VERIFY_STATUSES = [
  'valid',
  'superseded',
  'revoked',
  'expired',
  'hash-mismatch',
] as const;
export type VerifyStatus = (typeof VERIFY_STATUSES)[number];

export const VERIFY_STATUS_LABELS: Record<VerifyStatus, string> = {
  valid: 'Valid',
  superseded: 'Superseded',
  revoked: 'Revoked',
  expired: 'Expired',
  'hash-mismatch': 'Does not match',
};

/** Where the console serves a file a verify code names (the tampered slip). */
export function demoVerifyFileHref(name: string): string {
  return `/demo/verify-files/${encodeURIComponent(name)}`;
}
