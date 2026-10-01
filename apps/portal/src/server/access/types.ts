import type { FormKV1 } from '@adili/forms';

import type { components } from './schema.gen';

type Schemas = components['schemas'];

export type AccessRequest = Omit<Schemas['AccessRequest'], 'formK'> & {
  /** The contract types it loosely (`FormK`); it is a `form-k.v1` document as submitted. */
  formK: FormKV1;
};
export type AccessCommission = Schemas['AccessCommission'];
export type AccessRequestStatus = Schemas['AccessRequestStatus'];
export type Decision = Schemas['Decision'];
export type Ground = Schemas['Ground'];
export type Outcome = Schemas['Outcome'];
export type ProblemDetails = Schemas['ProblemDetails'];
export type RegisterEntry = Schemas['RegisterEntry'];

/**
 * The contract's request, read with its Form K typed: the service validates every document
 * against `form-k.v1` on receipt and returns it as submitted.
 */
export function readAccessRequest(request: Schemas['AccessRequest']): AccessRequest {
  return request as unknown as AccessRequest;
}
