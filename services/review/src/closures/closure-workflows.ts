import { Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';
import { v7 as uuidv7 } from 'uuid';

import { config } from '../config.js';
import { SweepScheduling } from '../sweep-schedule.js';
import {
  CLOSURE_NOTICES_WORKFLOW,
  CLOSURE_SWEEPS_WORKFLOW,
  type ClosureNoticesInput,
  closureNoticesWorkflowId,
  closureSweepScheduleId,
} from './contract.js';
import type { closureNotices } from './workflows.js';

/**
 * Starts the bulk closure workflows on Temporal (ADR-003): the notices of each approved chunk,
 * and the schedule of the daily closure sweep, which the service keeps on start
 * (`CLOSURE_SWEEP_CRON` in Nairobi time; `off` keeps none). Workflows are started by name: the
 * worker bundles the code.
 */
@Injectable()
export class ClosureWorkflows extends SweepScheduling {
  constructor(@InjectTemporalClient() temporal: Client) {
    super(temporal, {
      name: 'closure',
      workflowType: CLOSURE_SWEEPS_WORKFLOW,
      scheduleId: closureSweepScheduleId(config.TEMPORAL_TASK_QUEUE),
      cron: config.CLOSURE_SWEEP_CRON,
    });
  }

  /** The notices of one committed chunk of a bulk approval; a new workflow per chunk. */
  async startNotices(input: ClosureNoticesInput): Promise<void> {
    await this.temporal.workflow.start<typeof closureNotices>(CLOSURE_NOTICES_WORKFLOW, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: closureNoticesWorkflowId(uuidv7()),
      args: [input],
    });
  }
}
