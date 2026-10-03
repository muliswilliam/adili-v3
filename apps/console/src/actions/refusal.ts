import type { ServiceError } from '../server/service-call';

/**
 * Why the review service refused a decision on a ladder, as the Actions screens word it: the separation-of-duties rule
 * (`proposer`, `reviewer-of-record`), a step or restart for supervisors only (`role`), a step no
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
