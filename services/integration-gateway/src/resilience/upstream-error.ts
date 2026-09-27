/** Why a registry call failed. Each counts as a failure towards the system's circuit breaker. */
export type UpstreamFailure = 'timeout' | 'upstream-error';

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
