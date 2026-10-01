/**
 * A referral as ICMS registers it (integration-gateway.yaml `IcmsReferralRequest`). Personal
 * data: it travels to the gateway only, never into logs, events, the database or workflow history.
 */
export interface IcmsReferralRequest {
  /** The `RFL` reference: ICMS registers a referral once by it. */
  referralReference: string;
  nationalId: string;
  fullName: string;
  /** The referring Commission's issuer code, e.g. `PSC`. */
  referringCommission: string;
  grounds: string;
  /** At most 8,000 characters. */
  details: string;
}

/** integration-gateway.yaml `IcmsReferral`: the registration as ICMS holds it. */
export interface IcmsReferral {
  referralReference: string;
  /** Null until ICMS registered it (`pending`). */
  caseNumber: string | null;
  status: 'registered' | 'pending' | 'failed';
  registeredAt: string | null;
  sentAt: string;
}

/**
 * The integration-gateway (or ICMS behind it) is unreachable, answered 503 or outside its
 * contract: nothing is registered, and the push retries with backoff.
 */
export class IntegrationGatewayUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'IntegrationGatewayUnavailable';
  }
}

/**
 * What the reporting service asks of the integration-gateway's ICMS adapter (spec 09 BE-4), one
 * synchronous hop per call (ADR-013). A Nest token: the service uses
 * `HttpIntegrationGatewayClient`, tests a fake.
 */
export abstract class IntegrationGatewayClient {
  /**
   * `submitIcmsReferral`: registers the referral with ICMS (the referring Commission travels in
   * it) and answers the registration (a case number now, or `pending`). Idempotent by referral
   * reference: a replay answers the stored registration and registers nothing twice. Throws
   * `IntegrationGatewayUnavailable` when ICMS cannot be reached and `InternalApiRejected` when the
   * gateway refuses the request.
   */
  abstract submitReferral(referral: IcmsReferralRequest): Promise<IcmsReferral>;

  /**
   * `getIcmsReferral`: the stored registration of the referral `referralReference`, or null
   * for none. Throws `IntegrationGatewayUnavailable` when the gateway cannot be reached.
   */
  abstract getReferral(referralReference: string): Promise<IcmsReferral | null>;
}
