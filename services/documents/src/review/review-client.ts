/** The Commission has no issued clarification with this id: unknown, a draft, or another's. */
export class ClarificationNotFound extends Error {
  constructor(readonly clarificationId: string) {
    super(`No issued clarification ${clarificationId} for this Commission`);
    this.name = 'ClarificationNotFound';
  }
}

/** The review service is unreachable, refused the service's token, or answered off contract. */
export class ReviewUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReviewUnavailable';
  }
}

/**
 * The review service's internal API as issuing its letters needs it (ADR-013: the issue request
 * names the record, the payload is pulled), acting for a Commission. A Nest token: the service
 * uses `HttpReviewClient`, tests a fake.
 */
export abstract class ReviewClient {
  /**
   * The fields of the Commission's clarification letter (`internalGetClarificationLetterPayload`),
   * as the review service serves them: the template checks them. Throws `ClarificationNotFound`
   * or `ReviewUnavailable`.
   */
  abstract clarificationLetterPayload(tenant: string, clarificationId: string): Promise<unknown>;
}
