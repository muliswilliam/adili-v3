import { Injectable, Logger, Module } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { InjectTemporalClient } from '@adili/temporal';
import {
  type Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client';

import { config } from '../config.js';
import { workflowUnavailable } from '../problems.js';
import {
  LEA_REQUEST_WORKFLOW,
  type LeaRequestSignal,
  type LeaRequestWorkflowInput,
  leaRequestWorkflowId,
} from './contract.js';
import type { leaRequest } from './workflows.js';

/**
 * Starts `LeaRequestWorkflow` on Temporal (ADR-003), one per law enforcement request, and signals
 * it when the request changes. The start is the last step of the transaction that receives the
 * request, so a request never runs without its fourteen-day clock: Temporal unreachable is 503 and
 * the transaction rolls back (a run started for it then finds no request and ends).
 */
@Injectable()
export class LeaRequestWorkflows {
  private readonly logger = new Logger(LeaRequestWorkflows.name);

  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  async start(input: LeaRequestWorkflowInput): Promise<void> {
    try {
      await this.temporal.workflow.start<typeof leaRequest>(LEA_REQUEST_WORKFLOW, {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: leaRequestWorkflowId(input.requestId),
        args: [input],
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      });
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return;
      this.logger.error(
        { requestId: input.requestId, err: errorType(error) },
        'Could not start LeaRequestWorkflow',
      );
      throw workflowUnavailable('The request cannot be received right now. Try again shortly.');
    }
  }

  /**
   * Tells the workflow the request changed, after the change has committed. One that ended has
   * nothing to do; one Temporal cannot reach now is logged, not failed: the workflow reads the
   * request every few hours while it waits for the decision.
   */
  async signal(requestId: string, signal: LeaRequestSignal): Promise<void> {
    try {
      await this.temporal.workflow.getHandle(leaRequestWorkflowId(requestId)).signal(signal);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return;
      this.logger.warn(
        { requestId, signal, err: errorType(error) },
        'Could not signal LeaRequestWorkflow',
      );
    }
  }
}

/** `LeaRequestWorkflows` for the modules that start or signal the workflow. */
@Module({ providers: [LeaRequestWorkflows], exports: [LeaRequestWorkflows] })
export class LeaRequestWorkflowsModule {}
