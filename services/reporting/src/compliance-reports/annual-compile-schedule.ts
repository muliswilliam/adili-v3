import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, ScheduleAlreadyRunning, ScheduleOverlapPolicy } from '@temporalio/client';

import { config } from '../config.js';
import { ANNUAL_COMPILE_WORKFLOW, annualCompileScheduleId } from './contract.js';
import type { annualCompile } from './workflows.js';

/** How long the service waits before trying again to keep the schedule when Temporal is down. */
const SCHEDULE_RETRY_MS = 60_000;

/**
 * The Temporal schedule of the yearly compile (spec 09: Form M is compiled at the end of each
 * financial year), which the service keeps on start: `ANNUAL_COMPILE_CRON` in Nairobi time,
 * 06:00 on 1 July by default; `off` keeps none.
 */
@Injectable()
export class AnnualCompileSchedule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AnnualCompileSchedule.name);
  private retry: NodeJS.Timeout | undefined;

  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  onApplicationBootstrap(): void {
    if (config.ANNUAL_COMPILE_CRON === 'off') return;
    // Not awaited: the service starts even if Temporal is down, and tries again until it answers.
    this.keepSchedule();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retry);
  }

  /**
   * Creates the yearly compile schedule of this task queue, or brings an existing one to the
   * configured time. A run still going when the next is due finishes first.
   */
  async ensureSchedule(cron = config.ANNUAL_COMPILE_CRON): Promise<string> {
    const scheduleId = annualCompileScheduleId(config.TEMPORAL_TASK_QUEUE);
    const spec = { cronExpressions: [cron], timezone: 'Africa/Nairobi' };
    try {
      await this.temporal.schedule.create<typeof annualCompile>({
        scheduleId,
        spec,
        action: {
          type: 'startWorkflow',
          workflowType: ANNUAL_COMPILE_WORKFLOW,
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
      this.logger.warn({ err: error }, 'Could not keep the yearly compile schedule; trying again');
      this.retry = setTimeout(() => {
        this.keepSchedule();
      }, SCHEDULE_RETRY_MS);
      this.retry.unref();
    });
  }
}
