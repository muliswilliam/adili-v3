import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { TemporalWorkerModule } from '@adili/temporal';

import { CipherModule } from '../cipher.module.js';
import { ClockModule } from '../clock.module.js';
import { config } from '../config.js';
import { NationalReportActivities } from '../national-reports/activities.js';
import { NationalReportsController } from '../national-reports/national-reports.controller.js';
import { NationalReportsService } from '../national-reports/national-reports.service.js';
import { UpstreamModule } from '../upstream.module.js';
import { ComplianceReportActivities } from './activities.js';
import { AnnualCompileActivities } from './annual-compile-activities.js';
import { AnnualCompileSchedule } from './annual-compile-schedule.js';
import { ComplianceReportsController } from './compliance-reports.controller.js';
import { ComplianceReportsService } from './compliance-reports.service.js';
import { EaccReportsController } from './eacc-reports.controller.js';
import { EaccReportsService } from './eacc-reports.service.js';
import { FederatedReportsController } from './federated-reports.controller.js';
import { NationalChaseActivities } from './national-chase-activities.js';
import { NationalChaseSchedule } from './national-chase-schedule.js';
import { ReportSignOffService } from './report-sign-off.service.js';
import { ReportWorkflowsModule } from './report-workflows.js';

/**
 * The workflows module next to this file: `workflows.ts` when running from source (dev server,
 * tests), `workflows.js` in the build.
 */
const workflowsPath = fileURLToPath(
  new URL(`./workflows${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url),
);

/**
 * Compliance reports (spec 09): the Form M workspace endpoints, federated submission, EACC's
 * intake and report viewer, EACC's national consolidated report, the schedules of the yearly
 * compile and of EACC's chase, and the reporting worker hosting `ComplianceReportWorkflow`, the
 * yearly compile, `NationalConsolidationWorkflow`, `NationalReportApprovalWorkflow` and their
 * activities.
 */
@Module({
  imports: [
    ClockModule,
    CipherModule,
    UpstreamModule,
    ReportWorkflowsModule,
    TemporalWorkerModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowsPath,
      // One worker per service: every workflow of the reporting service runs on this queue.
      activities: [
        ComplianceReportActivities,
        AnnualCompileActivities,
        NationalChaseActivities,
        NationalReportActivities,
      ],
      imports: [ClockModule, CipherModule, UpstreamModule, ReportWorkflowsModule],
    }),
  ],
  controllers: [
    ComplianceReportsController,
    FederatedReportsController,
    EaccReportsController,
    NationalReportsController,
  ],
  providers: [
    ComplianceReportsService,
    ReportSignOffService,
    EaccReportsService,
    NationalReportsService,
    AnnualCompileSchedule,
    NationalChaseSchedule,
  ],
})
export class ComplianceReportsModule {}
