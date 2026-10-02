/**
 * Another service refused a call (a write with a 4xx its contract names, or a read in a state
 * that refuses it): the call itself is wrong, so sending it again changes nothing. HTTP routes
 * answer it with their own problem; workflow activities turn it into a non-retryable failure
 * (`rethrowAsActivityFailure` in activity-failures.ts), so Temporal does not send it again.
 */
export class UpstreamRefused extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
  ) {
    super(`The ${service} service refused the request with ${String(status)}`);
    this.name = 'UpstreamRefused';
  }
}

/**
 * `ServiceClient.call` handlers turning each of `statuses` into `UpstreamRefused`; any other
 * status the caller did not expect stays the client's "unavailable" error: an outage, which
 * activities retry (with bounded attempts, activity-retry.ts).
 */
export function refusedWith(
  service: string,
  statuses: readonly number[],
): Record<number, () => never> {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      (): never => {
        throw new UpstreamRefused(service, status);
      },
    ]),
  );
}
