/*
 * Verification IDs are printed under every QR code (ADR-010): `ADL-` followed by
 * hyphen-separated groups of Crockford base32 (no I, L, O or U, so they read aloud safely).
 */
const PATTERN = /^ADL(?:-[0-9A-HJKMNP-TV-Z]{1,4}){2,8}$/;

/** Uppercases, removes spaces and maps look-alike letters the way Crockford base32 does. */
export function normalizeVerificationId(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/(?<=-.*)[IL]/g, '1')
    .replace(/(?<=-.*)O/g, '0');
}

export function isVerificationId(value: string): boolean {
  return PATTERN.test(value);
}
