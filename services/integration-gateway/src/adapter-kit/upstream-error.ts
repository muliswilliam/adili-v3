import type { UnavailableReason } from '../db/schema.js';

/**
 * Why a registry call failed: the unavailable reasons the registry itself causes, including its
 * own rate limit refusing us (429). Each counts as a failure towards the system's circuit breaker.
 */
export type UpstreamFailure = Extract<
  UnavailableReason,
  'timeout' | 'rate-limited' | 'upstream-error'
>;

/** A registry did not give a usable answer. Messages never quote personal data. */
export class UpstreamError extends Error {
  override readonly name = 'UpstreamError';

  constructor(
    readonly reason: UpstreamFailure,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
