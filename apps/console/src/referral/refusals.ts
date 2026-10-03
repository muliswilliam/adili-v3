import { type CodedRefusal, problemLabel } from '../server/service-call';

/**
 * The refusals of review's referral endpoints (spec 08) the screens explain, by problem code,
 * with each one's HTTP status. Shared by the server calls and the screens, so not a `.server`
 * module.
 */

/** Proposing a referral from a case. */
export const PROPOSE_REFUSAL_STATUS = {
  /** One from the case already waits for approval. */
  'referral-open': 409,
  /** Only the case's assignee proposes. */
  'not-the-assignee': 403,
} as const satisfies Record<string, 403 | 409>;

/** Approving or declining a referral. */
export const DECISION_REFUSAL_STATUS = {
  /** The caller proposed it or held one of its cases (with `reason`). */
  'separation-of-duties': 403,
  /** A reviewer, not a supervisor. */
  'supervisor-required': 403,
  /** It was decided already. */
  'not-proposed': 409,
} as const satisfies Record<string, 403 | 409>;

/** Why review refused a referral proposal. */
export type ProposeRefusal = CodedRefusal<keyof typeof PROPOSE_REFUSAL_STATUS>;

/** Why review refused approving or declining a referral. */
export type DecisionRefusal = CodedRefusal<keyof typeof DECISION_REFUSAL_STATUS>;

/** The refusal's status and code, as a dialog prints it ("409 referral-open"). */
export function referralRefusalProblem(refusal: ProposeRefusal | DecisionRefusal): string {
  const status =
    refusal.kind === 'referral-open' || refusal.kind === 'not-the-assignee'
      ? PROPOSE_REFUSAL_STATUS[refusal.kind]
      : DECISION_REFUSAL_STATUS[refusal.kind];
  return problemLabel(status, refusal.kind);
}
