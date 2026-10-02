import { Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import { config } from '../config.js';
import {
  COPILOT_JOB_FINISHED_WORKFLOW,
  type CopilotJobFinished,
  copilotJobWorkflowId,
} from './contract.js';
import type { copilotJobFinished } from './workflows.js';

/**
 * Starts `copilotJobFinished` on Temporal, one per ended job. A start is idempotent: a running or
 * completed workflow for the job is left as it is; only a failed one is started again.
 */
@Injectable()
export class CopilotWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  async jobFinished(job: CopilotJobFinished): Promise<void> {
    try {
      await this.temporal.workflow.start<typeof copilotJobFinished>(COPILOT_JOB_FINISHED_WORKFLOW, {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: copilotJobWorkflowId(job.jobId),
        args: [job],
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
}
