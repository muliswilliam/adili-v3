import type { FormKV1 } from '@adili/forms';

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
