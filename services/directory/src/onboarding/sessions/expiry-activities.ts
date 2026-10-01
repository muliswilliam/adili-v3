import { Injectable, Logger } from '@nestjs/common';

import { OnboardingSessionSweeper } from './expiry-sweep.js';

/**
 * Activities of `onboardingSessionExpiry` (hosted by the directory's worker). Every method is an
 * activity: keep helpers elsewhere.
 */
@Injectable()
export class OnboardingExpiryActivities {
  private readonly logger = new Logger(OnboardingExpiryActivities.name);

  constructor(private readonly sweeper: OnboardingSessionSweeper) {}

  /** Ends every live session past its expiry; returns how many. */
  async expireOnboardingSessions(): Promise<number> {
    const ended = await this.sweeper.sweep();
    if (ended > 0) this.logger.log(`Ended ${ended} expired onboarding sessions`);
    return ended;
  }
}
