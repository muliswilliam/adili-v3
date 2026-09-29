import { Injectable, Logger } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import {
  type Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client';

import { config } from '../config.js';
import {
  CLARIFICATION_WORKFLOW,
  type ClarificationSignal,
  type ClarificationWorkflowInput,
  clarificationWorkflowId,
} from './contract.js';
import type { clarification } from './workflows.js';

/**
 * Starts `ClarificationWorkflow` on Temporal (ADR-003), one per issued clarification, and signals
 * it when the declarant responds or the reviewer resolves or withdraws. A start is idempotent: a
 * running workflow for the clarification is left as it is. A closed one may be followed by a new
 * run, which only happens when an issue transaction rolled back after its start and the
 * clarification was issued again.
 */
@Injectable()
export class ClarificationWorkflows {
  private readonly logger = new Logger(ClarificationWorkflows.name);

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

  /**
   * Ends the workflow's clock, after the change has committed. A workflow that already ended has
   * nothing to stop; one Temporal cannot reach now stops on its own, since its activities read
   * the clarification before reminding or marking it overdue. So a failed signal never fails the
   * request that sent it.
   */
  async signal(clarificationId: string, signal: ClarificationSignal): Promise<void> {
    try {
      await this.temporal.workflow
        .getHandle(clarificationWorkflowId(clarificationId))
        .signal(signal);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return;
      this.logger.warn(
        { clarificationId, signal, error: error instanceof Error ? error.name : 'unknown' },
        'Could not signal ClarificationWorkflow',
      );
    }
  }
}
