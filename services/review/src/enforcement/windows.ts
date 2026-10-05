import type { LadderPolicy } from '../directory/directory-client.js';
import type { LadderStep } from './contract.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The demo stack's windows after each step (`DEMO_LADDER_*_WINDOW`, milliseconds); empty, so the
 * policy's apply, unless the service runs in demo mode with them set.
 */
export interface DemoLadderWindows {
  notice?: number;
  warning?: number;
  stoppage?: number;
}

/**
 * When the declarant's window after a step issued at `issuedAt` ends, from the Commission's ladder
 * policy, or the demo stack's window for the step when it has one; none after the disciplinary
 * referral (the ladder then waits for compliance).
 */
export function stepWindowEndsAt(
  issuedAt: Date,
  policy: LadderPolicy,
  step: LadderStep,
  demo: DemoLadderWindows = {},
): Date | null {
  const ms = (days: number, demoMs: number | undefined) =>
    new Date(issuedAt.getTime() + (demoMs ?? days * DAY_MS));
  switch (step) {
    case 'notice-to-comply':
      return ms(policy.noticeWindowDays, demo.notice);
    case 'warning':
      return ms(policy.warningWindowDays, demo.warning);
    case 'salary-stoppage':
      return ms(policy.stoppageWindowDays, demo.stoppage);
    case 'disciplinary-referral':
      return null;
  }
}
