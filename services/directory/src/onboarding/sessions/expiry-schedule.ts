import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, ScheduleAlreadyRunning, ScheduleOverlapPolicy } from '@temporalio/client';

import { config } from '../../config.js';
import type { onboardingSessionExpiry } from './expiry-workflow.js';

/** Workflow type of the expiry sweep (the exported function's name). */
export const ONBOARDING_SESSION_EXPIRY_WORKFLOW = 'onboardingSessionExpiry';
/** How long to wait before trying again when Temporal could not be reached. */
const RETRY_MS = 30 * 1000;

/** Id of the expiry schedule of the task queue `taskQueue` (one per service deployment). */
export function onboardingExpiryScheduleId(taskQueue = config.TEMPORAL_TASK_QUEUE): string {
  return `${taskQueue}-onboarding-session-expiry`;
}

/**
 * Makes sure the Temporal schedule that sweeps expired onboarding sessions exists (ADR-003:
 * Temporal is the scheduler): `onboardingSessionExpiry` on the directory's task queue every
 * minute, a run skipped while the previous one still runs. Each replica asks at startup; the
 * first creates it and the others find it there. Temporal down at startup: it asks again every
 * 30 seconds, without holding startup up.
 */
@Injectable()
export class OnboardingExpirySchedule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OnboardingExpirySchedule.name);
  private retry: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  onApplicationBootstrap(): void {
    void this.ensure();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.retry);
  }

  /** Creates the schedule unless it exists; true once it does. */
  async ensure(): Promise<boolean> {
    try {
      await this.temporal.schedule.create<typeof onboardingSessionExpiry>({
        scheduleId: onboardingExpiryScheduleId(),
        spec: { intervals: [{ every: '1 minute' }] },
        action: {
          type: 'startWorkflow',
          workflowType: ONBOARDING_SESSION_EXPIRY_WORKFLOW,
          taskQueue: config.TEMPORAL_TASK_QUEUE,
          workflowExecutionTimeout: '5 minutes',
        },
        policies: { overlap: ScheduleOverlapPolicy.SKIP, catchupWindow: '1 minute' },
      });
      this.logger.log('Created the onboarding session expiry schedule');
      return true;
    } catch (error) {
      if (error instanceof ScheduleAlreadyRunning) return true;
      this.logger.warn({ err: error }, 'Onboarding session expiry schedule not ensured; retrying');
      if (!this.stopped) {
        this.retry = setTimeout(() => void this.ensure(), RETRY_MS);
        this.retry.unref();
      }
      return false;
    }
  }
}
