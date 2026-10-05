import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, ScheduleAlreadyRunning, ScheduleOverlapPolicy } from '@temporalio/client';

import { config } from '../config.js';
import { AUDIT_ANCHORING_WORKFLOW, auditAnchoringScheduleId } from './contract.js';

/** How long the service waits before trying again to keep the schedule when Temporal is down. */
const SCHEDULE_RETRY_MS = 60_000;

/**
 * The Temporal schedule of the daily anchoring, which the service keeps on start:
 * `AUDIT_ANCHOR_CRON` in Nairobi time; `off` keeps none. The service starts even if Temporal is
 * down, and tries again until it answers. A run still going when the next is due finishes first.
 */
@Injectable()
export class AnchoringSchedule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AnchoringSchedule.name);
  private retry: NodeJS.Timeout | undefined;

  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  onApplicationBootstrap(): void {
    if (config.AUDIT_ANCHOR_CRON === 'off') return;
    // Not awaited: the service starts even if Temporal is down.
    this.keepSchedule();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retry);
  }

  /** Creates the schedule of this task queue, or brings an existing one to the configured time. */
  async ensureSchedule(cron = config.AUDIT_ANCHOR_CRON): Promise<string> {
    const scheduleId = auditAnchoringScheduleId(config.TEMPORAL_TASK_QUEUE);
    const spec = { cronExpressions: [cron], timezone: 'Africa/Nairobi' };
    try {
      await this.temporal.schedule.create({
        scheduleId,
        spec,
        action: {
          type: 'startWorkflow',
          workflowType: AUDIT_ANCHORING_WORKFLOW,
          taskQueue: config.TEMPORAL_TASK_QUEUE,
          args: [],
        },
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
      });
    } catch (error) {
      if (!(error instanceof ScheduleAlreadyRunning)) throw error;
      await this.temporal.schedule
        .getHandle(scheduleId)
        .update((previous) => ({ ...previous, spec }));
    }
    return scheduleId;
  }

  private keepSchedule(): void {
    this.ensureSchedule().catch((error: unknown) => {
      this.logger.warn({ err: error }, 'Could not keep the anchoring schedule; trying again');
      this.retry = setTimeout(() => {
        this.keepSchedule();
      }, SCHEDULE_RETRY_MS);
      this.retry.unref();
    });
  }
}
