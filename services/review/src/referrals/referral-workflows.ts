import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import {
  type Client,
  ScheduleAlreadyRunning,
  ScheduleOverlapPolicy,
  WorkflowExecutionAlreadyStartedError,
} from '@temporalio/client';

import { config } from '../config.js';
import {
  REFERRAL_SENDING_WORKFLOW,
  REFERRAL_SWEEPS_WORKFLOW,
  type ReferralSendingInput,
  referralSendingWorkflowId,
  referralSweepScheduleId,
} from './contract.js';
import type { referralSending, referralSweeps } from './workflows.js';

/** How long the service waits before trying again to keep the schedule when Temporal is down. */
const SCHEDULE_RETRY_MS = 60_000;

/**
 * Starts the referral workflows on Temporal (ADR-003): the sending of each approved referral, and
 * the schedule of the daily referral sweep, which the service keeps on start
 * (`REFERRAL_SWEEP_CRON` in Nairobi time; `off` keeps none). Workflows are started by name: the
 * worker bundles the code.
 */
@Injectable()
export class ReferralWorkflows implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReferralWorkflows.name);
  private retry: NodeJS.Timeout | undefined;

  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  onApplicationBootstrap(): void {
    if (config.REFERRAL_SWEEP_CRON === 'off') return;
    // Not awaited: the service starts even if Temporal is down, and tries again until it answers.
    this.keepSchedule();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retry);
  }

  /**
   * The sending of an approved referral, one per referral. A running one is left as it is; a
   * closed one may be followed by a new run, which only happens when an approval transaction
   * rolled back after its start and the referral was approved again.
   */
  async startSending(input: ReferralSendingInput): Promise<void> {
    try {
      await this.temporal.workflow.start<typeof referralSending>(REFERRAL_SENDING_WORKFLOW, {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: referralSendingWorkflowId(input.referralId),
        args: [input],
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }

  /**
   * Creates the daily referral sweep schedule of this task queue, or brings an existing one to the
   * configured time. Overlapping runs are skipped.
   */
  async ensureSchedule(cron = config.REFERRAL_SWEEP_CRON): Promise<string> {
    const scheduleId = referralSweepScheduleId(config.TEMPORAL_TASK_QUEUE);
    const spec = { cronExpressions: [cron], timezone: 'Africa/Nairobi' };
    try {
      await this.temporal.schedule.create<typeof referralSweeps>({
        scheduleId,
        spec,
        action: {
          type: 'startWorkflow',
          workflowType: REFERRAL_SWEEPS_WORKFLOW,
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
      this.logger.warn({ err: error }, 'Could not keep the referral sweep schedule; trying again');
      this.retry = setTimeout(() => {
        this.keepSchedule();
      }, SCHEDULE_RETRY_MS);
      this.retry.unref();
    });
  }
}
