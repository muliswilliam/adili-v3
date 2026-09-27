import { useNavigate, useRouter } from '@tanstack/react-router';

import type { OnboardingSession } from '../../server/directory/types';
import { leaveOnboarding } from '../../server/onboarding';
import type { StepProblem, StepResult } from '../../server/onboarding.server';
import type { StartAgainNotice } from './problems';
import { routeForSession, type StepRoute } from './steps';

export interface SettleContext {
  /** The route of the step that ran; a session still on it stays. */
  route: StepRoute;
  /** The Commission's slug, kept on step 1 when the declarant has to start again. */
  commission: string;
  navigate: (options: {
    to: StepRoute;
    search?: { commission?: string; notice?: StartAgainNotice };
  }) => Promise<unknown>;
  /** Reruns the loaders, whose guard sends the page to the session's step. */
  invalidate: () => Promise<unknown>;
  /** Takes a session that stays on this step, e.g. after a resend or a contact entered. */
  onStay?: (session: OnboardingSession) => void;
}

/**
 * What every step does with a result it does not show itself: moves on to the session's
 * route, goes back to step 1 with the reason when the session has ended, or reruns the guard
 * when another tab moved the session on. Hands back any other problem for the step to show.
 */
export async function settle(
  result: StepResult,
  { route, commission, navigate, invalidate, onStay }: SettleContext,
): Promise<StepProblem | null> {
  if (result.ok) {
    const target = routeForSession(result.session);
    if (target === route && onStay) {
      onStay(result.session);
    } else {
      await navigate({ to: target });
    }
    return null;
  }
  if (result.code === 'ended' || result.code === 'too-many') {
    await navigate({ to: '/get-started', search: { commission, notice: result.code } });
    return null;
  }
  if (result.code === 'moved') {
    await invalidate();
    return null;
  }
  return result;
}

/** `settle` bound to the router, for a step on `route`. */
export function useSettle(
  options: Pick<SettleContext, 'route' | 'commission' | 'onStay'>,
): (result: StepResult) => Promise<StepProblem | null> {
  const navigate = useNavigate();
  const router = useRouter();
  return (result) =>
    settle(result, { ...options, navigate, invalidate: () => router.invalidate() });
}

/**
 * Forgets the session in this browser (the cookie is cleared on the server) and goes back to
 * step 1, with the Commission kept when given and saying why when there is a reason.
 */
export function useStartAgain(commission?: string): (notice?: StartAgainNotice) => Promise<void> {
  const navigate = useNavigate();
  return async (notice) => {
    await leaveOnboarding();
    await navigate({ to: '/get-started', search: { commission, notice } });
  };
}
