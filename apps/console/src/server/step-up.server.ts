import { hasFreshStepUp, type Session } from '@adili/bff-auth';

import type { Unauthenticated } from './as-viewer.server';

/** What the console knows of the session's last proof of identity (spec 06 step-up). */
export interface StepUpStatus {
  ok: true;
  /**
   * A step-up recent enough to confirm with. A hint for the UI: the service checks the access
   * token itself and answers 403 `step-up-required` otherwise.
   */
  fresh: boolean;
}

export function stepUpStatus(
  session: Session | null,
  now: number = Date.now(),
): StepUpStatus | Unauthenticated {
  if (!session) return { ok: false, error: { kind: 'unauthenticated' } };
  return { ok: true, fresh: hasFreshStepUp(session, now) };
}
