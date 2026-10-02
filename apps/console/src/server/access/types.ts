import type { FormKV1 } from '@adili/forms';
import type { Assert, MatchesAccessCopy } from '@adili/ui';

import type { components } from './api.gen';

type Schemas = components['schemas'];

export type AccessRequestStatus = Schemas['AccessRequestStatus'];
/**
 * access.yaml `OfficerRequestView`, with its Form K typed as the form-k.v1 document it is (the
 * contract names it an open object; the access service validated it on submission).
 */
export type OfficerRequestView = Omit<Schemas['OfficerRequestView'], 'formK'> & {
  formK: FormKV1;
};
export type QueueItem = Schemas['QueueItem'];
/** A `QueueItem` status: an `AccessRequestStatus`, or a law enforcement request's. */
export type QueueStatus = QueueItem['status'];
export type QueuePage = Schemas['QueuePage'];
export type RegisterEntry = Schemas['RegisterEntry'];
export type Representations = Schemas['Representations'];
export type RosterCandidate = Schemas['RosterCandidate'];
export type RosterCandidates = Schemas['RosterCandidates'];
export type AttachmentDownload = Schemas['AttachmentDownload'];
export type Scope = Schemas['Scope'];

/** The access service's problem details, with the registered `code` the console acts on. */
export interface AccessProblem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** A `PROBLEM_CODES` code (api-kit), e.g. `officer-resolved`. */
  code?: string;
  /** Fields at fault, by dotted path. */
  errors?: { path: string; message: string }[];
}

/** A law enforcement request (Regs r.23), as its officer or the Commission reads it. */
export type LeaRequest = Schemas['LeaRequest'];
export type LeaRequestStatus = Schemas['LeaRequestStatus'];
export type LeaRequestInput = Schemas['LeaRequestInput'];
export type VerifyLeaRequest = Schemas['VerifyLeaRequest'];
export type LeaProvenance = Schemas['LeaProvenance'];
/** A Commission a written request can address, with the declaration years it can ask for. */
export type AccessCommission = Schemas['AccessCommission'];
export type Decision = Schemas['Decision'];
export type DecisionInput = Schemas['DecisionInput'];
export type Outcome = Schemas['Outcome'];
export type Ground = Schemas['Ground'];
export type Package = Schemas['Package'];

/** Fails to compile when the contract and the shared access table in @adili/ui drift apart. */
export type ContractMatchesSharedCopy = Assert<
  MatchesAccessCopy<{ status: AccessRequestStatus; leaStatus: LeaRequestStatus; outcome: Outcome }>
>;
