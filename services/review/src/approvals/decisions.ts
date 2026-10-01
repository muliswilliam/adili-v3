import { HttpStatus } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';

import { type ApprovalParties, requireCanApprove } from './separation-of-duties.js';

/** What waits for a decision, and the field its 409 names its status in. */
const DECIDED = {
  determination: 'determinationStatus',
  step: 'actionStatus',
  referral: 'referralStatus',
} as const;

/**
 * 409 `not-proposed`: approving, returning, declining, withdrawing or reassigning something that no
 * longer waits for a decision.
 */
export function notProposed(
  detail = 'This has been decided; it no longer waits for a decision.',
  extra: Record<string, unknown> = {},
): ProblemException {
  return new ProblemException(
    { type: 'not-proposed', title: 'Conflict', status: HttpStatus.CONFLICT, detail },
    { code: 'not-proposed', ...extra },
  );
}

/** Decisions act on a proposal still waiting only: anything else is a 409 naming its status. */
export function requireProposed(subject: keyof typeof DECIDED, status: string): void {
  if (status === 'proposed') return;
  throw notProposed(`The ${subject} is ${status}; it no longer waits for a decision.`, {
    [DECIDED[subject]]: status,
  });
}

/**
 * A proposal locked for an officer's decision (with whatever `lock` locks alongside it): 404 when
 * invisible, then the separation-of-duties rule applied to the caller with the parties the
 * proposal names (403).
 */
export async function lockForDecision<Locked>(
  principal: Principal,
  lock: () => Promise<Locked | undefined>,
  partiesOf: (locked: Locked) => Promise<ApprovalParties>,
): Promise<Locked> {
  const locked = notFoundIfInvisible(await lock());
  requireCanApprove(principal, await partiesOf(locked));
  return locked;
}
