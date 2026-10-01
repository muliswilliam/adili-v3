/**
 * Another service refused a request (a write with a 4xx its contract names, or a read in a state
 * that refuses it, e.g. a referral with no roster record): the request itself is wrong, so
 * sending it again changes nothing. Activities do not retry it.
 */
export class InternalApiRejected extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
  ) {
    super(`The ${service} service refused the request with ${String(status)}`);
    this.name = 'InternalApiRejected';
  }
}

/**
 * `ServiceClient.call` handlers turning each of `statuses` into `InternalApiRejected`; any other
 * status the caller did not expect stays the client's "unavailable" error, which is retried.
 */
export function refusedWith(
  service: string,
  statuses: readonly number[],
): Record<number, () => never> {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      (): never => {
        throw new InternalApiRejected(service, status);
      },
    ]),
  );
}
