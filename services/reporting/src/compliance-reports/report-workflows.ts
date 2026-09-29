import { Injectable, Module } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';

import { config } from '../config.js';
import {
  COMPLIANCE_REPORT_WORKFLOW,
  complianceReportWorkflowId,
  NATIONAL_CONSOLIDATION_WORKFLOW,
  nationalConsolidationWorkflowId,
  RECOMPILE_SIGNAL,
  type ReportWorkflowInput,
  SUBMITTED_SIGNAL,
} from './contract.js';
import type { complianceReport, nationalConsolidation } from './workflows.js';

/**
 * Starts `ComplianceReportWorkflow` on Temporal (ADR-003), one per Commission and financial
 * year, or signals the running one; and EACC's chase, one per financial year.
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

  /**
   * Starts EACC's chase of the year's non-reporting Commissions (`NationalConsolidationWorkflow`,
   * one per financial year). False when it runs already.
   */
  async startNationalChase(fy: number): Promise<boolean> {
    try {
      await this.temporal.workflow.start<typeof nationalConsolidation>(
        NATIONAL_CONSOLIDATION_WORKFLOW,
        {
          taskQueue: config.TEMPORAL_TASK_QUEUE,
          workflowId: nationalConsolidationWorkflowId(fy),
          args: [{ fy }],
        },
      );
      return true;
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return false;
      throw error;
    }
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
