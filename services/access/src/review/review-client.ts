import type { AccessLegalBasis } from '@adili/events/contracts';

import type { Section } from '../scope.js';
import type { components } from './review-api.gen.js';

/**
 * The clarifications a Form K grant discloses with the declarations, as the access service asks
 * review for them (review.yaml `ClarificationDisclosureRequest`, with the Commission in
 * `X-Acting-Tenant` and the deciding officer in `X-Acting-Subject`): those issued on the
 * declarations the grant disclosed, cut to the household members and sections it allows. The
 * read is audited there with the grant reference as legal basis, the officer and the recipient.
 */
export interface ClarificationDisclosureRequest {
  /** The declarant (the request's resolved person). */
  personId: string;
  /** The Commission the request was decided by. */
  tenant: string;
  /** Token subject of the access officer who decided the grant. */
  officerSubject: string;
  /** The `ARQ` reference of the grant. */
  grantReference: string;
  legalBasis: Extract<AccessLegalBasis, 'act-s36-1'>;
  /** Token subject of the applicant the package is for. */
  recipientSubject: string;
  /** The declarations the grant's disclosure holds (`disclosure.v1` versions' references). */
  declarationReferences: string[];
  includeSpouses: boolean;
  includeChildren: boolean;
  sections: Section[];
}

/** review.yaml `DisclosedClarification`: handed to documents with the disclosure, never stored. */
export type DisclosedClarification = components['schemas']['DisclosedClarification'];

/** The review service is unreachable or answered outside its contract; activities retry. */
export class ReviewUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReviewUnavailable';
  }
}

/**
 * What the access service asks of the review service, which holds the clarifications of
 * declarations (spec 07a): those a Form K grant discloses (spec 10, decision 7). A Nest token:
 * the service uses `HttpReviewClient`, tests a fake.
 */
export abstract class ReviewClient {
  /** Oldest issued first; empty when none was issued on those declarations within the scope. */
  abstract discloseClarifications(
    request: ClarificationDisclosureRequest,
  ): Promise<DisclosedClarification[]>;
}
