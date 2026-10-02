import { Injectable, Module } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';

import { signalWorkflow, startWorkflow } from '../workflow-control.js';
import {
  LEA_REQUEST_WORKFLOW,
  type LeaRequestSignal,
  type LeaRequestWorkflowInput,
  leaRequestWorkflowId,
} from './contract.js';

/**
 * Starts `LeaRequestWorkflow` (ADR-003), one per law enforcement request, inside the receiving
 * transaction, so a request never runs without its fourteen-day clock; and signals it once a
 * change to the request commits. See workflow-control.ts for why the start comes before the
 * commit.
 */
@Injectable()
export class LeaRequestWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  async start(input: LeaRequestWorkflowInput): Promise<void> {
    await startWorkflow(this.temporal, {
      type: LEA_REQUEST_WORKFLOW,
      workflowId: leaRequestWorkflowId(input.requestId),
      args: [input],
      unavailable: 'The request cannot be received right now. Try again shortly.',
    });
  }

  async signal(requestId: string, signal: LeaRequestSignal): Promise<void> {
    await signalWorkflow(this.temporal, leaRequestWorkflowId(requestId), signal);
  }
}

/** `LeaRequestWorkflows` for the modules that start or signal the workflow. */
@Module({ providers: [LeaRequestWorkflows], exports: [LeaRequestWorkflows] })
export class LeaRequestWorkflowsModule {}
