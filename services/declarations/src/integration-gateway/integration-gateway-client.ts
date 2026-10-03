import type { RegistryResult, RegistrySystem } from '../suggestions/registry-results.js';

/**
 * The legal basis of every lookup the declarations service makes: the declarant asked for it
 * while filing (Data Protection Act s.30(1)(a); integration-gateway.yaml `X-Legal-Basis`).
 */
export const DECLARANT_REQUEST = 'declarant-request';

/**
 * One registry lookup for one person. Personal data: the national ID travels to the gateway only,
 * in the request body, never into logs, events, the database or workflow history.
 */
export interface RegistryLookup {
  system: RegistrySystem;
  /** The Commission the lookup is made for (`X-Acting-Tenant`); the stored result is its. */
  tenant: string;
  nationalId: string;
  /** Recorded by the gateway on the result and its audit event (`X-Legal-Basis`). */
  legalBasis: typeof DECLARANT_REQUEST;
  /** The declaration the lookup is for (`X-Case-Ref`). */
  caseRef: string;
  /**
   * The declarant, whose declaration the lookup is for (`X-Subject-Person`): the gateway audits
   * reads of the result as reads of their data, whether the person looked up is them or their
   * spouse or child.
   */
  subjectPersonId: string;
}

/**
 * The integration-gateway is unreachable, refused the service's token, or answered outside its
 * contract. For a lookup this is the same as the registry being unavailable: it is retried, and a
 * set whose registry never answered is `unavailable`.
 */
export class IntegrationGatewayUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IntegrationGatewayUnavailable';
  }
}

/**
 * What the declarations service asks of the integration-gateway (ADR-013: the only egress to the
 * registries): KRA, NTSA, BRS and ArdhiSasa lookups by national ID, on the declarant's request
 * (spec 05b). A Nest token: the service uses `HttpIntegrationGatewayClient`, tests a fake.
 */
export abstract class IntegrationGatewayClient {
  /**
   * The registry's uniform verification result for the person: `found` with its records,
   * `not-found`, or `unavailable` (timeout, open breaker, paused). Throws
   * `IntegrationGatewayUnavailable` when the gateway itself cannot be reached.
   */
  abstract lookup(request: RegistryLookup): Promise<RegistryResult>;
}
