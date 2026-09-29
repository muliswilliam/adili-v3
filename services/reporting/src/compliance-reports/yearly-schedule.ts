import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Client, ScheduleAlreadyRunning, ScheduleOverlapPolicy } from '@temporalio/client';

import { config } from '../config.js';

/** How long the service waits before trying again to keep a schedule when Temporal is down. */
const SCHEDULE_RETRY_MS = 60_000;

/**
 * A Temporal schedule the service keeps on start: a cron in Nairobi time starting a workflow
 * without arguments on the service's task queue; `off` keeps none. The service starts even if
 * Temporal is down, and tries again until it answers.
 */
export abstract class YearlySchedule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(this.constructor.name);
  private retry: NodeJS.Timeout | undefined;

  constructor(
    private readonly temporal: Client,
    private readonly options: {
      /** The configured cron, or `off`. */
      cron: string;
      scheduleId: string;
      workflowType: string;
    },
  ) {}

  onApplicationBootstrap(): void {
    if (this.options.cron === 'off') return;
    // Not awaited: the service starts even if Temporal is down.
    this.keepSchedule();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retry);
  }

  /**
   * Creates the schedule of this task queue, or brings an existing one to the configured time. A
   * run still going when the next is due finishes first.
   */
  async ensureSchedule(cron = this.options.cron): Promise<string> {
    const { scheduleId, workflowType } = this.options;
    const spec = { cronExpressions: [cron], timezone: 'Africa/Nairobi' };
    try {
      await this.temporal.schedule.create({
        scheduleId,
        spec,
        action: {
          type: 'startWorkflow',
          workflowType,
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
      this.logger.warn({ err: error }, 'Could not keep the schedule; trying again');
      this.retry = setTimeout(() => {
        this.keepSchedule();
      }, SCHEDULE_RETRY_MS);
      this.retry.unref();
    });
  }
}
