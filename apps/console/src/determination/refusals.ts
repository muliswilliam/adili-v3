import { type CodedRefusal, DECISION_REFUSAL_STATUS, problemLabel } from '../server/service-call';

/**
 * The refusals of review's determination endpoints (spec 08) the screens explain, by problem
 * code, with each one's HTTP status. Shared by the server calls and the screens, so not a
 * `.server` module.
 */

/** Each refusal's HTTP status, as review.yaml answers it. */
export const REFUSAL_STATUS = {
  /** Propose: one is already proposed or approved. */
  'determination-open': 409,
  /** Propose: a clarification of the case is still open. */
  'clarification-open': 409,
  /** Propose: only the case's assignee proposes. */
  'not-the-assignee': 403,
  /** Withdraw: only the proposer withdraws. */
  'not-the-proposer': 403,
  /** Approve, return or withdraw: the decision refusals (`not-proposed` for withdraw too). */
  ...DECISION_REFUSAL_STATUS,
} as const satisfies Record<string, 403 | 409>;

/** Why review refused a determination call, as review.yaml's problem codes name it. */
export type DeterminationRefusal = CodedRefusal<keyof typeof REFUSAL_STATUS>;

/** The refusal's status and code, as a dialog prints it ("403 separation-of-duties"). */
export function refusalProblem(refusal: DeterminationRefusal): string {
  return problemLabel(REFUSAL_STATUS[refusal.kind], refusal.kind);
}
