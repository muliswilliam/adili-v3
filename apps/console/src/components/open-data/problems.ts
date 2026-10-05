import type { ReleasesResult } from '../../server/open-data-releases.server';
import { messages as m, mismatchLabel } from './messages';

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

/**
 * Why a build (`buildOpenDataRelease`) wrote nothing, or may still be running: a snapshot from
 * the releases list, or the next version of a withdrawn release. `fallback` for anything else.
 */
export function buildFailure(result: ReleasesFailure, fallback: string = m.buildFailed): string {
  const { error } = result;
  if (error.kind === 'problem') {
    const { code, mismatches } = error.problem;
    if (code === 'reconciliation-failed') {
      return m.reconciliationFailed((mismatches ?? []).map(mismatchLabel).join(', '));
    }
    if (code === 'fy-not-started') return m.fyNotStarted;
    if (code === 'ncr-not-built') return m.ncrNotBuilt;
    if (code === 'ncr-not-approved') return m.ncrNotApproved;
    if (code === 'annual-release-published') return m.annualStillPublished;
    if (isProblem(error.problem, 'idempotency-key-in-use')) return m.buildStillRunning;
  }
  if (error.kind === 'unavailable' && error.problemType === 'storage-unavailable') {
    return m.storageUnavailable;
  }
  if (error.kind === 'unavailable' && error.problemType === 'directory-unavailable') {
    return m.directoryUnavailable;
  }
  return fallback;
}
