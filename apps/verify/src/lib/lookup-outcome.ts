import type { VerificationResult } from '../server/verification/types';

/**
 * What a lookup of a verification code came to, as the result page shows it:
 *
 * - `found`: a document with this code was issued; its `status` is valid, superseded, revoked or
 *   expired (never `not-found`).
 * - `not-found`: no document has this code. Likely forged.
 * - `malformed`: the code cannot be a verification code; the API was not asked.
 * - `rate-limited`: too many lookups from this connection; says nothing about the document.
 * - `unavailable`: the API did not answer usefully; says nothing about the document either.
 */
export type LookupOutcome =
  | {
      kind: 'found';
      result: VerificationResult & { status: Exclude<VerificationResult['status'], 'not-found'> };
    }
  | { kind: 'not-found' }
  | { kind: 'malformed' }
  | { kind: 'rate-limited'; retryAfterSeconds: number }
  | { kind: 'unavailable' };
