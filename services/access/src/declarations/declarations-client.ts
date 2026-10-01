import type { AccessLegalBasis } from '@adili/events/contracts';

import type { Section } from '../scope.js';
import type { components } from './declarations-api.gen.js';

/**
 * A grant's scoped disclosure, as the access service asks declarations for it
 * (declarations.yaml `DisclosureRequest`): only the declarant's versions of these years, the
 * household members and the sections the grant allows. The read is audited there with the grant
 * reference as legal basis and the recipient.
 */
export interface DisclosureRequest {
  /** The declarant (the request's resolved person). */
  personId: string;
  /** The Commission the request was decided by. */
  tenant: string;
  /** The `ARQ` or `LEA` reference of the grant. */
  grantReference: string;
  legalBasis: Extract<AccessLegalBasis, 'act-s36-1' | 'act-s36-2'>;
  /** Token subject of the applicant or law enforcement officer the package is for. */
  recipientSubject: string;
  years: number[];
  includeSpouses: boolean;
  includeChildren: boolean;
  sections: Section[];
}

/** declarations.yaml `DisclosureDocument` (`disclosure.v1`): handed to documents, never stored. */
export type DisclosureDocument = components['schemas']['DisclosureDocument'];

/** declarations.yaml `InternalVersionDocument`: a submitted version in full, for a certified copy. */
export type VersionDocument = components['schemas']['InternalVersionDocument'];

/** The declarations service is unreachable or answered outside its contract; activities retry. */
export class DeclarationsUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DeclarationsUnavailable';
  }
}

/**
 * What the access service asks of the declarations service, the only one that decrypts a
 * declaration (spec 10 "Why scoping lives in declarations"): a grant's scoped disclosure and a
 * version in full for the declarant's certified copy. A Nest token: the service uses
 * `HttpDeclarationsClient`, tests a fake.
 */
export abstract class DeclarationsClient {
  /** Null when the declarant has no version in the scope (declarations answers 404). */
  abstract renderDisclosure(request: DisclosureRequest): Promise<DisclosureDocument | null>;

  /**
   * Version `version` of the declaration in full, read for `declarantSubject`; null when it is
   * not theirs or does not exist.
   */
  abstract fullDocument(
    declarationId: string,
    version: number,
    declarantSubject: string,
  ): Promise<VersionDocument | null>;
}
