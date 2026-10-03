import type { ServiceAnswer, ServiceClient } from '@adili/api-kit';

import type { paths } from './review-api.gen.js';

/** The review service's generated client, as `ServiceClient.call` hands it to a request. */
type ReviewApi = Parameters<Parameters<ServiceClient<paths>['call']>[0]>[0];

/** The Commission a payload is pulled for (review answers 404 for another Commission's record). */
interface ActingTenant {
  'X-Acting-Tenant': string;
}

/** How issuance pulls a record's payload from the review service. */
export interface ReviewRoute {
  /** The property an issue request names the record by, as the route's path parameter. */
  idField: string;
  /**
   * A letter's fields come within ADR-013's 2 s; a referral's package carries the evidence the
   * review service pulls as it answers, and gets the longer package budget (HttpReviewClient).
   */
  budget: 'letter' | 'package';
  /** The request for record `id`'s payload, through the client generated from review.yaml. */
  request(api: ReviewApi, id: string, header: ActingTenant): Promise<ServiceAnswer>;
}

/**
 * The records of the review service whose documents issuance renders from a pulled payload, each
 * with its payload's route: a clarification's letter (spec 07a), a determination's decision
 * letter, an administrative action's step letter and a referral's evidence package (spec 08).
 */
export const REVIEW_RECORDS = {
  clarification: {
    idField: 'clarificationId',
    budget: 'letter',
    request: (api, id, header) =>
      api.GET('/internal/v1/review/clarifications/{clarificationId}/letter-payload', {
        params: { path: { clarificationId: id }, header },
      }),
  },
  determination: {
    idField: 'determinationId',
    budget: 'letter',
    request: (api, id, header) =>
      api.GET('/internal/v1/review/determinations/{determinationId}/letter-payload', {
        params: { path: { determinationId: id }, header },
      }),
  },
  action: {
    idField: 'actionId',
    budget: 'letter',
    request: (api, id, header) =>
      api.GET('/internal/v1/review/actions/{actionId}/letter-payload', {
        params: { path: { actionId: id }, header },
      }),
  },
  referral: {
    idField: 'referralId',
    budget: 'package',
    request: (api, id, header) =>
      api.GET('/internal/v1/review/referrals/{referralId}/package-payload', {
        params: { path: { referralId: id }, header },
      }),
  },
} as const satisfies Record<string, ReviewRoute>;

export type ReviewRecord = keyof typeof REVIEW_RECORDS;

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
