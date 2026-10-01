import type { LookupOutcome } from '../lib/lookup-outcome';
import type { VerificationClient } from './verification/client.server';
import type { VerificationResult } from './verification/types';

/** When the API says 429 without saying for how long. */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

/**
 * `GET /v1/verify/{verificationId}`: the document's status and what its disclosure level lets
 * the page show. `verificationId` is already normalised (the API normalises too).
 */
export async function lookUp(
  client: VerificationClient,
  verificationId: string,
): Promise<LookupOutcome> {
  try {
    const { data, response } = await client.GET('/v1/verify/{verificationId}', {
      params: { path: { verificationId } },
    });
    if (data) return found(data);
    switch (response.status) {
      case 404:
        return { kind: 'not-found' };
      case 400:
        return { kind: 'malformed' };
      case 429:
        return { kind: 'rate-limited', retryAfterSeconds: retryAfter(response.headers) };
      default:
        return { kind: 'unavailable' };
    }
  } catch {
    return { kind: 'unavailable' };
  }
}

function found(result: VerificationResult): LookupOutcome {
  if (result.status === 'not-found') return { kind: 'not-found' };
  return { kind: 'found', result: { ...result, status: result.status } };
}

/** Seconds to wait: Retry-After, else RateLimit-Reset (both in seconds from verification-api). */
function retryAfter(headers: Headers): number {
  for (const candidate of [headers.get('retry-after'), headers.get('ratelimit-reset')]) {
    const seconds = Number(candidate ?? Number.NaN);
    if (Number.isInteger(seconds) && seconds > 0) return seconds;
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}
