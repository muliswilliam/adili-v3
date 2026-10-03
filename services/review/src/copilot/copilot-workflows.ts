import { Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import { config } from '../config.js';
import {
  COPILOT_JOB_FINISHED_WORKFLOW,
  COPILOT_POLICY_CHANGED_WORKFLOW,
  type CopilotJobFinished,
  copilotJobWorkflowId,
  copilotPolicyWorkflowId,
} from './contract.js';
import type { copilotJobFinished, copilotPolicyChanged } from './workflows.js';

/**
 * Starts the copilot's event-driven workflows on Temporal: `copilotJobFinished` one per ended
 * job, `copilotPolicyChanged` one per policy change event and Commission. A start is idempotent: a running or
 * completed workflow is left as it is; only a failed one is started again.
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

  async policyChanged(eventId: string, tenant: string): Promise<void> {
    try {
      await this.temporal.workflow.start<typeof copilotPolicyChanged>(
        COPILOT_POLICY_CHANGED_WORKFLOW,
        {
          taskQueue: config.TEMPORAL_TASK_QUEUE,
          workflowId: copilotPolicyWorkflowId(eventId, tenant),
          args: [{ tenant }],
          workflowIdConflictPolicy: 'USE_EXISTING',
          workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
        },
      );
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
}
