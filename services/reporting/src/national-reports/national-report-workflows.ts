import { Injectable, Module } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';

import {
  OpenDataReleaseWorkflows,
  OpenDataReleaseWorkflowsModule,
} from '../open-data/release-workflows.js';
import { startOnce } from '../workflow-start.js';
import {
  NATIONAL_REPORT_APPROVAL_WORKFLOW,
  type NationalReportApprovalInput,
  nationalReportApprovalWorkflowId,
} from './contract.js';
import type { nationalReportApproval } from './workflows.js';

/** Starts the national consolidated report's workflows on Temporal (ADR-003). */
@Injectable()
export class NationalReportWorkflows {
  constructor(
    @InjectTemporalClient() private readonly temporal: Client,
    private readonly releases: OpenDataReleaseWorkflows,
  ) {}

  /**
   * The national consolidated report was approved: starts its approval workflow, which issues the
   * NCR PDF and ends the year's chase, and the open-data release workflow, which publishes the
   * year's annual release (spec 09b S5). Already started (a retried approval) is fine.
   */
  async approved(input: NationalReportApprovalInput): Promise<void> {
    await startOnce<typeof nationalReportApproval>(
      this.temporal,
      NATIONAL_REPORT_APPROVAL_WORKFLOW,
      nationalReportApprovalWorkflowId(input.nationalReportId),
      [input],
    );
    await this.releases.ncrApproved(input);
  }
}

/** `NationalReportWorkflows` for the national-reports module. */
@Module({
  imports: [OpenDataReleaseWorkflowsModule],
  providers: [NationalReportWorkflows],
  exports: [NationalReportWorkflows],
})
export class NationalReportWorkflowsModule {}
