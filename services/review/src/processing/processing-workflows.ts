import { Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import { config } from '../config.js';
import {
  DECLARATION_PROCESSING_WORKFLOW,
  type ProcessingInput,
  processingWorkflowId,
} from './contract.js';
import type { declarationProcessing } from './workflows.js';

/**
 * Starts `DeclarationProcessingWorkflow` on Temporal (ADR-003), one per submitted version. A start
 * is idempotent: a running or completed workflow for the version is left as it is; only a failed,
 * cancelled or terminated one is started again.
 */
@Injectable()
export class ProcessingWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  async start(input: ProcessingInput): Promise<void> {
    try {
      // By name: workflow code is loaded by the worker's bundler, not by this process.
      await this.temporal.workflow.start<typeof declarationProcessing>(
        DECLARATION_PROCESSING_WORKFLOW,
        {
          taskQueue: config.TEMPORAL_TASK_QUEUE,
          workflowId: processingWorkflowId(input.versionId),
          args: [input],
          workflowIdConflictPolicy: 'USE_EXISTING',
          workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
        },
      );
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
}
