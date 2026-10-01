import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Client, ScheduleAlreadyRunning, ScheduleOverlapPolicy } from '@temporalio/client';

import { config } from './config.js';

/** How long the service waits before trying again to keep a schedule when Temporal is down. */
export const SCHEDULE_RETRY_MS = 60_000;

/** A daily sweep the service keeps a Temporal schedule of. */
export interface Sweep {
  /** What the logs call it: `closure`, `referral`. */
  name: string;
  /** The workflow type the schedule starts, by name (the worker bundles the code). */
  workflowType: string;
  /** The schedule's id on this task queue. */
  scheduleId: string;
  /** When it runs, in Nairobi time; `off` keeps no schedule. */
  cron: string;
}

/**
 * The schedule of a daily sweep (ADR-003), kept by the service on start: created, or an existing
 * one brought to the configured time. Not awaited on start: the service starts even if Temporal
 * is down, and tries again every minute until it answers. Overlapping runs are skipped: a sweep
 * still running when the next is due finishes first.
 */
export abstract class SweepScheduling implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SweepScheduling.name);
  private retry: NodeJS.Timeout | undefined;

  protected constructor(
    protected readonly temporal: Client,
    private readonly sweep: Sweep,
  ) {}

  onApplicationBootstrap(): void {
    if (this.sweep.cron === 'off') return;
    this.keepSchedule();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retry);
  }

  /** Creates the sweep's schedule, or brings an existing one to `cron`; its id. */
  async ensureSchedule(cron = this.sweep.cron): Promise<string> {
    const { scheduleId, workflowType } = this.sweep;
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
      this.logger.warn(
        { err: error, sweep: this.sweep.name },
        'Could not keep the sweep schedule; trying again',
      );
      this.retry = setTimeout(() => {
        this.keepSchedule();
      }, SCHEDULE_RETRY_MS);
      this.retry.unref();
    });
  }
}
