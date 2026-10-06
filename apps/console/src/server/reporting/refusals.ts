import type { ReportingProblem } from './types';

/**
 * What a sign-off call's problem details mean, one map for the three callers (confirm, Mark
 * reviewed, the autosaves), each deciding what to do with it:
 *
 * - `busy`: 409 `idempotency-key-in-use`, the first request with this key is still running
 *   (confirm only: the edits and Mark reviewed send no Idempotency-Key);
 * - `compiling`: 409 `report-compiling`, a recompile is running (passing);
 * - `preview`: 409 `report-preview`, the report is a preview, which no sign-off takes;
 * - `step-up-required`, `forbidden` (another 403), `not-reviewed`, `incomplete`,
 *   `already-submitted` (409 `report-submitted`), `key-reused` (422), `not-found` (404);
 * - `invalid`: any other 4xx, a refusal of the request itself, the same again next time.
 */
export type SignOffRefusal =
  | 'busy'
  | 'compiling'
  | 'preview'
  | 'step-up-required'
  | 'forbidden'
  | 'not-reviewed'
  | 'incomplete'
  | 'already-submitted'
  | 'key-reused'
  | 'not-found'
  | 'invalid';

export function refusalOf({ type, status, code }: ReportingProblem): SignOffRefusal {
  // api-kit's idempotency problems carry their name as the type (only confirm sends a key).
  if (type === 'idempotency-key-in-use') return 'busy';
  if (status === 403) return code === 'step-up-required' ? 'step-up-required' : 'forbidden';
  if (code === 'report-compiling') return 'compiling';
  if (code === 'report-preview') return 'preview';
  if (code === 'report-submitted') return 'already-submitted';
  if (code === 'not-reviewed') return 'not-reviewed';
  if (code === 'incomplete') return 'incomplete';
  if (status === 422) return 'key-reused';
  if (status === 404) return 'not-found';
  return 'invalid';
}
