/**
 * The onboarding session expiry workflow, bundled into Temporal's deterministic sandbox with the
 * directory's other workflows (`src/workflows.ts`): import only `@temporalio/workflow` and types.
 */
import { proxyActivities } from '@temporalio/workflow';

import type { OnboardingExpiryActivities } from './expiry-activities.js';

const { expireOnboardingSessions } = proxyActivities<OnboardingExpiryActivities>({
  // Batches of 500 sessions; a minute is far more than a run takes.
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 3, initialInterval: '1 second', backoffCoefficient: 2 },
});

/**
 * `onboardingSessionExpiry`, started every minute by the `onboarding-session-expiry` schedule:
 * ends the onboarding sessions that ran out of time. Returns how many.
 */
export async function onboardingSessionExpiry(): Promise<number> {
  return expireOnboardingSessions();
}
