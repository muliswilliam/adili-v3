import { Injectable, Module } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';

import { startWorkflow } from '../workflow-control.js';
import {
  ONBOARDED_NOTICE_WORKFLOW,
  type OnboardedNoticeWorkflowInput,
  onboardedNoticeWorkflowId,
} from './contract.js';

/**
 * Starts `OnboardedNoticeWorkflow` (ADR-003), one per request linked to a declarant who onboarded
 * after the written notice, inside the linking transaction (see workflow-control.ts).
 */
@Injectable()
export class OnboardedNoticeWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  async start(input: OnboardedNoticeWorkflowInput): Promise<void> {
    await startWorkflow(this.temporal, {
      type: ONBOARDED_NOTICE_WORKFLOW,
      workflowId: onboardedNoticeWorkflowId(input.requestId),
      args: [input],
      unavailable: 'The declarant cannot be told online right now.',
    });
  }
}

/** `OnboardedNoticeWorkflows` for the modules that start the workflow. */
@Module({ providers: [OnboardedNoticeWorkflows], exports: [OnboardedNoticeWorkflows] })
export class OnboardedNoticeWorkflowsModule {}
