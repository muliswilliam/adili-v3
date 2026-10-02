import { useNavigate, useRouter } from '@tanstack/react-router';

import { leaveApplicantOnboarding } from '../../server/applicant-onboarding';
import type { ApplicantStepResult } from '../../server/applicant-onboarding.server';
import type {
  ApplicantOnboardingSession,
  IdentityDocumentKind,
} from '../../server/directory/types';
import type { StepProblem } from '../../server/onboarding.server';
import type { StartAgainNotice } from '../onboarding/problems';
import { type ApplicantRoute, routeForApplicantSession } from './steps';

export interface ApplicantSettleContext {
  /** The route of the step that ran; a session still on it stays. */
  route: ApplicantRoute;
  /** The document kind, kept on step 1 when the applicant has to start again. */
  kind: IdentityDocumentKind;
  navigate: (options: {
    to: ApplicantRoute;
    search?: { kind?: IdentityDocumentKind; notice?: StartAgainNotice };
  }) => Promise<unknown>;
  /** Reruns the loaders, whose guard sends the page to the session's step. */
  invalidate: () => Promise<unknown>;
  /** Takes a session that stays on this step, e.g. after a resend. */
  onStay?: (session: ApplicantOnboardingSession) => void;
}

/**
 * What every step does with a result it does not show itself, as for declarants (`settle` in
 * onboarding/settle.ts): moves on to the session's route, goes back to step 1 with the reason
 * when the session has ended, or reruns the guard when another tab moved the session on. Hands
 * back any other problem for the step to show.
 */
export async function settleApplicant(
  result: ApplicantStepResult,
  { route, kind, navigate, invalidate, onStay }: ApplicantSettleContext,
): Promise<StepProblem | null> {
  if (result.ok) {
    const target = routeForApplicantSession(result.session);
    if (target === route && onStay) onStay(result.session);
    else await navigate({ to: target });
    return null;
  }
  if (result.code === 'ended' || result.code === 'too-many') {
    await navigate({ to: '/access/get-started', search: { kind, notice: result.code } });
    return null;
  }
  if (result.code === 'moved') {
    await invalidate();
    return null;
  }
  return result;
}

/** `settleApplicant` bound to the router, for a step on `route`. */
export function useApplicantSettle(
  options: Pick<ApplicantSettleContext, 'route' | 'kind' | 'onStay'>,
): (result: ApplicantStepResult) => Promise<StepProblem | null> {
  const navigate = useNavigate();
  const router = useRouter();
  return (result) =>
    settleApplicant(result, { ...options, navigate, invalidate: () => router.invalidate() });
}

/**
 * Forgets the session in this browser (the cookie is cleared on the server) and goes back to a
 * step before it: Choose your ID by default, saying why when there is a reason, or Your details
 * to change what was entered.
 */
export function useApplicantStartAgain(
  kind?: IdentityDocumentKind,
): (
  notice?: StartAgainNotice,
  to?: '/access/get-started' | '/access/get-started/details',
) => Promise<void> {
  const navigate = useNavigate();
  return async (notice, to = '/access/get-started') => {
    await leaveApplicantOnboarding();
    await navigate({ to, search: { kind, notice } });
  };
}
