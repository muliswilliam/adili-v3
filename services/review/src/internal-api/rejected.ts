/**
 * Another service refused the request with a 4xx that sending it again does not change (e.g. an
 * upload that is not clean, a message notifications will not send): the request itself is wrong.
 * Activities do not retry it.
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

/** An `otherwise` handler of `ServiceClient.call` that throws `InternalApiRejected`. */
export function rejectedBy(service: string): (response: Response) => never {
  return (response) => {
    throw new InternalApiRejected(service, response.status);
  };
}
