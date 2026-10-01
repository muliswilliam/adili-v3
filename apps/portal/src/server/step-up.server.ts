import { hasFreshStepUp, type Session } from '@adili/bff-auth';

import type { Unauthenticated } from './results';

/** What the portal knows of the session's last proof of identity (spec 06 step-up). */
export interface StepUpStatus {
  status: 'ok';
  /** Authentication context class of the session's tokens (`acr`), e.g. `step-up`. */
  acr: string | null;
  /** When the declarant last authenticated (`auth_time`), in seconds since the epoch. */
  authTime: number | null;
  /**
   * A step-up recent enough to submit with. A hint for the UI: the declarations service checks
   * the access token itself and answers 403 `step-up-required` otherwise.
   */
  fresh: boolean;
}

export function stepUpStatus(
  session: Session | null,
  now: number = Date.now(),
): StepUpStatus | Unauthenticated {
  if (!session) return { status: 'unauthenticated' };
  return {
    status: 'ok',
    acr: session.acr,
    authTime: session.authTime,
    fresh: hasFreshStepUp(session, now),
  };
}
