import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, ScheduleAlreadyRunning, ScheduleOverlapPolicy } from '@temporalio/client';
import { v7 as uuidv7 } from 'uuid';

import { config } from '../config.js';
import {
  CLOSURE_NOTICES_WORKFLOW,
  CLOSURE_SWEEPS_WORKFLOW,
  type ClosureNoticesInput,
  closureNoticesWorkflowId,
  closureSweepScheduleId,
} from './contract.js';
import type { closureNotices, closureSweeps } from './workflows.js';

/** How long the service waits before trying again to keep the schedule when Temporal is down. */
const SCHEDULE_RETRY_MS = 60_000;

/**
 * Starts the bulk closure workflows on Temporal (ADR-003): the notices of each approved chunk,
 * and the schedule of the daily closure sweep, which the service keeps on start (`CLOSURE_SWEEP_CRON`
 * in Nairobi time; `off` keeps none). Workflows are started by name: the worker bundles the code.
 */
@Injectable()
export class ClosureWorkflows implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ClosureWorkflows.name);
  private retry: NodeJS.Timeout | undefined;

  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  onApplicationBootstrap(): void {
    if (config.CLOSURE_SWEEP_CRON === 'off') return;
    // Not awaited: the service starts even if Temporal is down, and tries again until it answers.
    this.keepSchedule();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retry);
  }

  /** The notices of one committed chunk of a bulk approval; a new workflow per chunk. */
  async startNotices(input: ClosureNoticesInput): Promise<void> {
    await this.temporal.workflow.start<typeof closureNotices>(CLOSURE_NOTICES_WORKFLOW, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: closureNoticesWorkflowId(uuidv7()),
      args: [input],
    });
  }

  /**
   * Creates the daily closure sweep schedule of this task queue, or brings an existing one to the
   * configured time. Overlapping runs are skipped: a sweep still running when the next is due
   * finishes first.
   */
  async ensureSchedule(cron = config.CLOSURE_SWEEP_CRON): Promise<string> {
    const scheduleId = closureSweepScheduleId(config.TEMPORAL_TASK_QUEUE);
    const spec = { cronExpressions: [cron], timezone: 'Africa/Nairobi' };
    try {
      await this.temporal.schedule.create<typeof closureSweeps>({
        scheduleId,
        spec,
        action: {
          type: 'startWorkflow',
          workflowType: CLOSURE_SWEEPS_WORKFLOW,
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
      this.logger.warn({ err: error }, 'Could not keep the closure sweep schedule; trying again');
      this.retry = setTimeout(() => {
        this.keepSchedule();
      }, SCHEDULE_RETRY_MS);
      this.retry.unref();
    });
  }
}
