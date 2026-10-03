import type { ReleasesResult } from '../../server/open-data-releases.server';

export type ReleasesFailure = Extract<ReleasesResult<unknown>, { ok: false }>;

/** api-kit names some problems by `type` (the idempotency ones), the service by `code`. */
export function isProblem(problem: { type: string; code?: string }, name: string): boolean {
  return problem.code === name || problem.type === name;
}

/**
 * Whether a failed build, publish or withdraw may still have been, or be, recorded under its
 * Idempotency-Key: no answer (network, timeout, 5xx), or the first request with the key still
 * running. Its retry sends the same key; any other refusal wrote nothing and ends the key.
 */
export function mayBeRecorded({ error }: ReleasesFailure): boolean {
  return (
    error.kind === 'unavailable' ||
    (error.kind === 'problem' && isProblem(error.problem, 'idempotency-key-in-use'))
  );
}
