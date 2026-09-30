import type { AcknowledgementSlipPayload } from '../issuance/templates/acknowledgement-slip.v1.js';

/** What the declarations service gives for a submitted version's acknowledgement slip. */
export interface AcknowledgementPayload {
  /** The declarant: the slip is issued for them, the only person who may download it. */
  declarantPersonId: string;
  /** Exactly the fields the `acknowledgement-slip` v1 template prints. */
  slip: AcknowledgementSlipPayload;
}

/** The Commission has no such version: unknown, or another Commission's. */
export class VersionNotFound extends Error {
  constructor(
    readonly declarationId: string,
    readonly version: number,
  ) {
    super(`No version ${String(version)} of declaration ${declarationId} for this Commission`);
    this.name = 'VersionNotFound';
  }
}

/** The declarations service is unreachable, refused the service's token, or answered off contract. */
export class DeclarationsUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DeclarationsUnavailable';
  }
}

/**
 * The declarations service's internal API as issuing acknowledgement slips needs it (ADR-013:
 * events carry identifiers, the payload is pulled), acting for a Commission. A Nest token: the
 * service uses `HttpDeclarationsClient`, tests a fake.
 */
export abstract class DeclarationsClient {
  /**
   * The slip payload of the Commission's declaration version. Throws `VersionNotFound` or
   * `DeclarationsUnavailable`.
   */
  abstract acknowledgementPayload(
    tenant: string,
    declarationId: string,
    version: number,
  ): Promise<AcknowledgementPayload>;
}
