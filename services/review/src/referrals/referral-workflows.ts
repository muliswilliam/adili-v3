import { Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import { config } from '../config.js';
import { SweepScheduling } from '../sweep-schedule.js';
import {
  REFERRAL_SENDING_WORKFLOW,
  REFERRAL_SWEEPS_WORKFLOW,
  type ReferralSendingInput,
  referralSendingWorkflowId,
  referralSweepScheduleId,
} from './contract.js';
import type { referralSending } from './workflows.js';

/**
 * Starts the referral workflows on Temporal (ADR-003): the sending of each approved referral, and
 * the schedule of the daily referral sweep, which the service keeps on start
 * (`REFERRAL_SWEEP_CRON` in Nairobi time; `off` keeps none). Workflows are started by name: the
 * worker bundles the code.
 */
@Injectable()
export class ReferralWorkflows extends SweepScheduling {
  constructor(@InjectTemporalClient() temporal: Client) {
    super(temporal, {
      name: 'referral',
      workflowType: REFERRAL_SWEEPS_WORKFLOW,
      scheduleId: referralSweepScheduleId(config.TEMPORAL_TASK_QUEUE),
      cron: config.REFERRAL_SWEEP_CRON,
    });
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
}
