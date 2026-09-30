import { Injectable, Module } from '@nestjs/common';
import { InjectTemporalClient } from '@adili/temporal';
import { type Client, WorkflowNotFoundError } from '@temporalio/client';

import { config } from '../config.js';
import { startOnce } from '../workflow-start.js';
import {
  COMPLIANCE_REPORT_WORKFLOW,
  complianceReportWorkflowId,
  NATIONAL_CONSOLIDATION_WORKFLOW,
  nationalConsolidationWorkflowId,
  NCR_APPROVED_SIGNAL,
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
  startNationalChase(fy: number): Promise<boolean> {
    return startOnce<typeof nationalConsolidation>(
      this.temporal,
      NATIONAL_CONSOLIDATION_WORKFLOW,
      nationalConsolidationWorkflowId(fy),
      [{ fy }],
    );
  }

  /**
   * Tells the year's chase (`NationalConsolidationWorkflow`) that the national consolidated
   * report is approved, so it ends. False when no chase runs (not started, or ended already).
   */
  async endNationalChase(fy: number): Promise<boolean> {
    try {
      await this.temporal.workflow
        .getHandle(nationalConsolidationWorkflowId(fy))
        .signal(NCR_APPROVED_SIGNAL);
      return true;
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return false;
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
