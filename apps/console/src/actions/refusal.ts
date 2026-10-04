import { problemLabel, type ServiceError } from '../server/service-call';

/**
 * Why the review service refused a decision on a ladder: the separation-of-duties rule (`proposer`, `reviewer-of-record`), a step or restart for supervisors only (`role`), a step no
 * longer waiting (`not-proposed`) or a ladder not declined (`not-declined`). Null for anything
 * else (unavailable, signed out, not found).
 */
export type DecisionRefusal =
  'proposer' | 'reviewer-of-record' | 'role' | 'not-proposed' | 'not-declined';

export function decisionRefusal(error: ServiceError): DecisionRefusal | null {
  if (error.kind !== 'problem') return null;
  const problem = error.problem as typeof error.problem & { code?: unknown; reason?: unknown };
  const code = typeof problem.code === 'string' ? problem.code : problem.type;
  if (code === 'separation-of-duties') {
    return problem.reason === 'proposer' ? 'proposer' : 'reviewer-of-record';
  }
  if (code === 'supervisor-required') return 'role';
  if (code === 'not-proposed') return 'not-proposed';
  if (code === 'ladder-not-declined') return 'not-declined';
  return null;
}

/** Each refusal's status and problem code, as a dialog prints it ("403 separation-of-duties"). */
export const REFUSAL_PROBLEM: Record<DecisionRefusal, string> = {
  proposer: problemLabel(403, 'separation-of-duties'),
  'reviewer-of-record': problemLabel(403, 'separation-of-duties'),
  role: problemLabel(403, 'supervisor-required'),
  'not-proposed': problemLabel(409, 'not-proposed'),
  'not-declined': problemLabel(409, 'ladder-not-declined'),
};

/** The refusals that keep the officer from deciding, shown in place of the step's buttons. */
export type DecisionLock = Extract<DecisionRefusal, 'proposer' | 'reviewer-of-record' | 'role'>;

export function isLock(refusal: DecisionRefusal | null): refusal is DecisionLock {
  return refusal === 'proposer' || refusal === 'reviewer-of-record' || refusal === 'role';
}
