import type { FormKV1 } from '@adili/forms';
import type { Assert, MatchesAccessCopy } from '@adili/ui';

import type { components } from './schema.gen';

type Schemas = components['schemas'];

export type AccessRequest = Omit<Schemas['AccessRequest'], 'formK'> & {
  /** The contract types it loosely (`FormK`); it is a `form-k.v1` document as submitted. */
  formK: FormKV1;
};
export type AccessCommission = Schemas['AccessCommission'];
export type AccessRequestStatus = Schemas['AccessRequestStatus'];
/** A decision as the applicant and the declarant are told it: never who on the staff took it. */
export type Decision = Schemas['PublicDecision'];
export type Ground = Schemas['Ground'];
export type Outcome = Schemas['Outcome'];
export type Package = Schemas['Package'];

/** Fails to compile when the contract and the shared access words in @adili/ui drift apart. */
export type ContractMatchesSharedCopy = Assert<
  MatchesAccessCopy<{
    status: AccessRequestStatus;
    leaStatus: Schemas['LeaRequestStatus'];
    outcome: Outcome;
  }>
>;
export type ProblemDetails = Schemas['ProblemDetails'];
export type RegisterEntry = Schemas['RegisterEntry'];

/**
 * The contract's request, read with its Form K typed: the service validates every document
 * against `form-k.v1` on receipt and returns it as submitted.
 */
export function readAccessRequest(request: Schemas['AccessRequest']): AccessRequest {
  return request as unknown as AccessRequest;
}

/** A request the declarant was notified about: a Form K request, or a law-enforcement grant. */
export type DeclarantNotice = Schemas['DeclarantNotice'];
/** A Form K request: who asked and why, the window for their response, and the outcome. */
export type FormKDeclarantNotice = Schemas['FormKDeclarantNotice'];
/**
 * A law-enforcement grant, shown once access was granted: the agency, its case reference, the
 * outcome, its dates and the scope granted (what was disclosed), never the agency's reason or the
 * decision's reasons or grounds.
 */
export type Representations = Schemas['Representations'];
export type RepresentationsInput = Schemas['RepresentationsInput'];
export type RepresentationStance = Representations['stance'];
export type Scope = Schemas['Scope'];

/** One step of "who accessed my declaration", as the declarant may see it (S12). */
export type AccessHistoryEntry = Schemas['AccessHistoryEntry'];
/** A certified copy of one of the declarant's submitted versions (S13). */
export type CertifiedCopy = Schemas['CertifiedCopy'];
