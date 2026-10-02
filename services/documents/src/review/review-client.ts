/**
 * The records of the review service whose documents issuance renders from a pulled payload: a
 * clarification's letter (spec 07a), a determination's decision letter, an administrative
 * action's step letter and a referral's evidence package (spec 08).
 */
export type ReviewRecord = 'clarification' | 'determination' | 'action' | 'referral';

/**
 * The Commission has no such record with a document to issue: unknown, not issued or approved
 * yet, or another Commission's.
 */
export class ReviewRecordNotFound extends Error {
  constructor(
    readonly record: ReviewRecord,
    readonly id: string,
  ) {
    super(`No ${record} ${id} with a document to issue for this Commission`);
    this.name = 'ReviewRecordNotFound';
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
 * The review service's internal API as issuing its documents needs it (ADR-013: the issue request
 * names the record, the payload is pulled), acting for a Commission. A Nest token: the service
 * uses `HttpReviewClient`, tests a fake.
 */
export abstract class ReviewClient {
  /**
   * The fields of the document of the Commission's record, as the review service serves them
   * (`internalGetClarificationLetterPayload`, `internalGetDeterminationLetterPayload`,
   * `internalGetActionLetterPayload`, `internalGetReferralPackagePayload`): the template checks
   * them. Throws `ReviewRecordNotFound` or `ReviewUnavailable`.
   */
  abstract payload(record: ReviewRecord, tenant: string, id: string): Promise<unknown>;
}
