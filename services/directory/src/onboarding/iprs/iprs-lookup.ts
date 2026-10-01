/** A person's names as IPRS (the national population register) holds them. */
export interface IprsPerson {
  firstName: string;
  middleName: string | null;
  lastName: string;
}

/**
 * IPRS could not answer (the integration-gateway's circuit is open, it timed out, or it could not
 * be reached): the confirm step answers 503 `iprs-unavailable` and changes nothing.
 */
export class IprsUnavailable extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`IPRS lookup failed: ${reason}`, options);
    this.name = 'IprsUnavailable';
  }
}

/**
 * Looks a national ID up in IPRS through the integration-gateway (a Nest token). The HTTP adapter
 * (`HttpIprsLookup`) is used in every environment, `InMemoryIprsLookup` in API tests.
 */
export abstract class IprsLookup {
  /**
   * The person IPRS holds for `nationalId` (digits only), or null when IPRS has no such person.
   * @throws IprsUnavailable
   */
  abstract find(nationalId: string): Promise<IprsPerson | null>;
}
