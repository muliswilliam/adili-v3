import { Injectable, Module } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';

import { signalWorkflow, startWorkflow } from '../workflow-control.js';
import {
  ACCESS_REQUEST_WORKFLOW,
  type AccessRequestSignal,
  type AccessRequestWorkflowInput,
  accessRequestWorkflowId,
} from './contract.js';

/**
 * Starts `AccessRequestWorkflow` (ADR-003), one per request, at receipt (held for the applicant's
 * verification or not), inside the receiving transaction; and signals it once a change to the
 * request commits. See workflow-control.ts for why the start comes before the commit.
 */
@Injectable()
export class AccessRequestWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  async start(input: AccessRequestWorkflowInput): Promise<void> {
    await startWorkflow(this.temporal, {
      type: ACCESS_REQUEST_WORKFLOW,
      workflowId: accessRequestWorkflowId(input.requestId),
      args: [input],
      unavailable: 'The request cannot be taken forward right now. Try again shortly.',
    });
  }

  async signal(requestId: string, signal: AccessRequestSignal): Promise<void> {
    await signalWorkflow(this.temporal, accessRequestWorkflowId(requestId), signal);
  }
}

/** `AccessRequestWorkflows` for the modules that start or signal the workflow. */
@Module({ providers: [AccessRequestWorkflows], exports: [AccessRequestWorkflows] })
export class AccessRequestWorkflowsModule {}
