import { Injectable, Module } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';

import { startOnce } from '../workflow-start.js';
import {
  NATIONAL_REPORT_APPROVAL_WORKFLOW,
  type NationalReportApprovalInput,
  nationalReportApprovalWorkflowId,
} from './contract.js';
import type { nationalReportApproval } from './workflows.js';

/** Starts the national consolidated report's workflow on Temporal (ADR-003). */
@Injectable()
export class NationalReportWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  /**
   * The national consolidated report was approved: starts its approval workflow, which issues the
   * NCR PDF and ends the year's chase. Already started (a retried approval) is fine.
   */
  async approved(input: NationalReportApprovalInput): Promise<void> {
    await startOnce<typeof nationalReportApproval>(
      this.temporal,
      NATIONAL_REPORT_APPROVAL_WORKFLOW,
      nationalReportApprovalWorkflowId(input.nationalReportId),
      [input],
    );
  }
}

/** `NationalReportWorkflows` for the national-reports module. */
@Module({ providers: [NationalReportWorkflows], exports: [NationalReportWorkflows] })
export class NationalReportWorkflowsModule {}
