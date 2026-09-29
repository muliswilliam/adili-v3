import { Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import { config } from '../config.js';
import {
  CLARIFICATION_WORKFLOW,
  type ClarificationWorkflowInput,
  clarificationWorkflowId,
} from './contract.js';
import type { clarification } from './workflows.js';

/**
 * Starts `ClarificationWorkflow` on Temporal (ADR-003), one per issued clarification. A start is
 * idempotent: a running workflow for the clarification is left as it is. A closed one may be
 * followed by a new run, which only happens when an issue transaction rolled back after its start
 * and the clarification was issued again.
 */
@Injectable()
export class ClarificationWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  async start(input: ClarificationWorkflowInput): Promise<void> {
    try {
      // By name: workflow code is loaded by the worker's bundler, not by this process.
      await this.temporal.workflow.start<typeof clarification>(CLARIFICATION_WORKFLOW, {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: clarificationWorkflowId(input.clarificationId),
        args: [input],
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
}
