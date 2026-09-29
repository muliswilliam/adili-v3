import { Injectable } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';

import { config } from '../config.js';
import {
  COMPLIANCE_REPORT_WORKFLOW,
  complianceReportWorkflowId,
  RECOMPILE_SIGNAL,
  type ReportWorkflowInput,
} from './contract.js';
import type { complianceReport } from './workflows.js';

/**
 * Starts `ComplianceReportWorkflow` on Temporal (ADR-003), one per Commission and financial
 * year, or asks the running one to compile again.
 */
@Injectable()
export class ReportWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  /** Compiles the draft: starts the workflow, or signals `recompile` to the running one. */
  async compile(input: ReportWorkflowInput): Promise<void> {
    // By name: workflow code is loaded by the worker's bundler, not by this process.
    await this.temporal.workflow.signalWithStart<typeof complianceReport>(
      COMPLIANCE_REPORT_WORKFLOW,
      {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: complianceReportWorkflowId(input.tenant, input.fy),
        args: [input],
        signal: RECOMPILE_SIGNAL,
        signalArgs: [],
      },
    );
  }
}
