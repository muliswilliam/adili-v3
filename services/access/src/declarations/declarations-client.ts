import type { AccessLegalBasis } from '@adili/events/contracts';

import type { Section } from '../scope.js';
import type { components } from './declarations-api.gen.js';

/**
 * A grant's scoped disclosure, as the access service asks declarations for it
 * (declarations.yaml `DisclosureRequest`, with the Commission in `X-Acting-Tenant` and the deciding
 * officer in `X-Acting-Subject`): only the declarant's versions of these years, the household
 * members and the sections the grant allows. The read is audited there with the grant reference
 * as legal basis, the officer and the recipient.
 */
export interface DisclosureRequest {
  /** The declarant (the request's resolved person). */
  personId: string;
  /** The Commission the request was decided by. */
  tenant: string;
  /** Token subject of the access officer who decided the grant. */
  officerSubject: string;
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

/** declarations.yaml `FullVersionDocument`: a submitted version in full, for a certified copy. */
export type VersionDocument = components['schemas']['FullVersionDocument'];

/** A version of a declarant's declaration, asked for in full for their certified copy. */
export interface FullDocumentRequest {
  /** The Commission the declaration was filed with. */
  tenant: string;
  declarationId: string;
  version: number;
  /** The declarant: the version must be theirs. */
  personId: string;
  /**
   * Token subject of who asked for the copy, recorded as the actor in declarations' audit: the
   * declarant online, or the access officer recording their written application.
   */
  actingSubject: string;
  /**
   * Whom the copy is handed to, recorded as its recipient in declarations' audit: the declarant's
   * token subject when they asked online; for an application recorded by an access officer, the
   * representative's name when made through one, else the declarant (`person:<personId>`).
   */
  recipient: string;
}

/**
 * declarations.yaml `InternalPersonVersion`: one of a declarant's submitted versions at the
 * Commission, as the access officer chooses what a certified copy is of. No content.
 */
export type PersonVersion = components['schemas']['InternalPersonVersion'];

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
   * The version in full, read for the declarant; null when it is not theirs, not the Commission's
   * or does not exist.
   */
  abstract fullDocument(request: FullDocumentRequest): Promise<VersionDocument | null>;

  /**
   * The declarant's submitted versions at the Commission `tenant`, latest submitted first (empty
   * when it has none of theirs): what a certified copy can be of.
   */
  abstract personVersions(tenant: string, personId: string): Promise<PersonVersion[]>;
}
