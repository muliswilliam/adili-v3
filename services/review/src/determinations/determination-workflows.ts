import { Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import { config } from '../config.js';
import {
  DETERMINATION_ISSUANCE_WORKFLOW,
  type DeterminationIssuanceInput,
  determinationIssuanceWorkflowId,
} from './contract.js';
import type { determinationIssuance } from './workflows.js';

/**
 * Starts `DeterminationIssuanceWorkflow` on Temporal (ADR-003), one per approved determination. A
 * start is idempotent: a running workflow for the determination is left as it is. A closed one may
 * be followed by a new run, which only happens when an approval transaction rolled back after its
 * start and the determination was approved again.
 */
@Injectable()
export class DeterminationWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  async start(input: DeterminationIssuanceInput): Promise<void> {
    try {
      // By name: workflow code is loaded by the worker's bundler, not by this process.
      await this.temporal.workflow.start<typeof determinationIssuance>(
        DETERMINATION_ISSUANCE_WORKFLOW,
        {
          taskQueue: config.TEMPORAL_TASK_QUEUE,
          workflowId: determinationIssuanceWorkflowId(input.determinationId),
          args: [input],
          workflowIdConflictPolicy: 'USE_EXISTING',
          workflowIdReusePolicy: 'ALLOW_DUPLICATE',
        },
      );
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
}
