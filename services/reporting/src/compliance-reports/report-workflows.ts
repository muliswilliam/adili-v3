import { Injectable, Module } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import type { Client } from '@temporalio/client';

import { config } from '../config.js';
import {
  COMPLIANCE_REPORT_WORKFLOW,
  complianceReportWorkflowId,
  RECOMPILE_SIGNAL,
  type ReportWorkflowInput,
  SUBMITTED_SIGNAL,
} from './contract.js';
import type { complianceReport } from './workflows.js';

/**
 * Starts `ComplianceReportWorkflow` on Temporal (ADR-003), one per Commission and financial
 * year, or signals the running one.
 */
@Injectable()
export class ReportWorkflows {
  constructor(@InjectTemporalClient() private readonly temporal: Client) {}

  /** Compiles the draft: starts the workflow, or signals `recompile` to the running one. */
  compile(input: ReportWorkflowInput): Promise<void> {
    return this.signalWithStart(input, RECOMPILE_SIGNAL);
  }

  /**
   * The report was submitted: the workflow issues its Form M PDF and receipt, tells the officers
   * and ends. Starts it when it is not running (e.g. ended by an operator).
   */
  submitted(input: ReportWorkflowInput): Promise<void> {
    return this.signalWithStart(input, SUBMITTED_SIGNAL);
  }

  private async signalWithStart(input: ReportWorkflowInput, signal: string): Promise<void> {
    // By name: workflow code is loaded by the worker's bundler, not by this process.
    await this.temporal.workflow.signalWithStart<typeof complianceReport>(
      COMPLIANCE_REPORT_WORKFLOW,
      {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        workflowId: complianceReportWorkflowId(input.tenant, input.fy),
        args: [input],
        signal,
        signalArgs: [],
      },
    );
  }
}

/** `ReportWorkflows` for the HTTP modules and the worker's activities alike. */
@Module({ providers: [ReportWorkflows], exports: [ReportWorkflows] })
export class ReportWorkflowsModule {}
