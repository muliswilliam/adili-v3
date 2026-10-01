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
  ACCESS_REQUEST_WORKFLOW,
  type AccessRequestSignal,
  type AccessRequestWorkflowInput,
  accessRequestWorkflowId,
} from './contract.js';
import type { accessRequest } from './workflows.js';

/**
 * Starts `AccessRequestWorkflow` on Temporal (ADR-003), one per request that goes ahead, and
 * signals it when the request changes. The start is the last step of the transaction that made
 * the request `submitted`, so a request never goes ahead without its workflow: Temporal
 * unreachable is 503 and the transaction rolls back (a run started for it then finds no request
 * and ends). A start is idempotent: a running workflow for the request is left as it is.
 */
@Injectable()
export class AccessRequestWorkflows {
  private readonly logger = new Logger(AccessRequestWorkflows.name);

  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  async start(input: AccessRequestWorkflowInput): Promise<void> {
    try {
      // By name: workflow code is loaded by the worker's bundler, not by this process.
      await this.temporal.workflow.start<typeof accessRequest>(ACCESS_REQUEST_WORKFLOW, {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: accessRequestWorkflowId(input.requestId),
        args: [input],
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      });
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return;
      this.logger.error(
        { requestId: input.requestId, err: errorType(error) },
        'Could not start AccessRequestWorkflow',
      );
      throw workflowUnavailable(
        'The request cannot be taken forward right now. Try again shortly.',
      );
    }
  }

  /**
   * Tells the workflow the request changed, after the change has committed. A workflow that ended
   * already has nothing to do; one Temporal cannot reach now is logged, not failed: the change
   * stands, and the workflow's activities read the request before acting.
   */
  async signal(requestId: string, signal: AccessRequestSignal): Promise<void> {
    try {
      await this.temporal.workflow.getHandle(accessRequestWorkflowId(requestId)).signal(signal);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return;
      this.logger.warn(
        { requestId, signal, err: errorType(error) },
        'Could not signal AccessRequestWorkflow',
      );
    }
  }
}

/** `AccessRequestWorkflows` for the modules that start or signal the workflow. */
@Module({ providers: [AccessRequestWorkflows], exports: [AccessRequestWorkflows] })
export class AccessRequestWorkflowsModule {}
