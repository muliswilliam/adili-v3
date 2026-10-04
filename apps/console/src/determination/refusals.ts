import { problemLabel } from '../server/service-call';

/**
 * The refusals of review's determination endpoints (spec 08) the screens explain, by problem
 * code, with each one's HTTP status. Shared by the server calls and the screens, so not a
 * `.server` module.
 */

/** Why review refused a determination call, as review.yaml's problem codes name it. */
export type DeterminationRefusal =
  /** Propose: one is already proposed or approved (409). */
  | { kind: 'determination-open' }
  /** Propose: a clarification of the case is still open (409). */
  | { kind: 'clarification-open' }
  /** Propose: only the case's assignee proposes (403). */
  | { kind: 'not-the-assignee' }
  /** Approve or return: the caller proposed it or held the case (403). */
  | { kind: 'separation-of-duties'; reason: 'proposer' | 'reviewer-of-record' }
  /** Approve or return: a reviewer, not a supervisor (403). */
  | { kind: 'supervisor-required' }
  /** Withdraw: only the proposer withdraws (403). */
  | { kind: 'not-the-proposer' }
  /** Approve, return or withdraw: it was decided already (409). */
  | { kind: 'not-proposed' };

/** Each refusal's HTTP status, as review.yaml answers it. */
export const REFUSAL_STATUS: Record<DeterminationRefusal['kind'], 403 | 409> = {
  'determination-open': 409,
  'clarification-open': 409,
  'not-the-assignee': 403,
  'separation-of-duties': 403,
  'supervisor-required': 403,
  'not-the-proposer': 403,
  'not-proposed': 409,
};

/** The refusal's status and code, as a dialog prints it ("403 separation-of-duties"). */
export function refusalProblem(refusal: DeterminationRefusal): string {
  return problemLabel(REFUSAL_STATUS[refusal.kind], refusal.kind);
}
