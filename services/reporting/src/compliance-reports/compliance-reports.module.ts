import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { TemporalWorkerModule } from '@adili/temporal';

import { CipherModule } from '../cipher.module.js';
import { ClockModule } from '../clock.module.js';
import { config } from '../config.js';
import { UpstreamModule } from '../upstream.module.js';
import { ComplianceReportActivities } from './activities.js';
import { ComplianceReportsController } from './compliance-reports.controller.js';
import { ComplianceReportsService } from './compliance-reports.service.js';
import { ReportWorkflows } from './report-workflows.js';

/**
 * The workflows module next to this file: `workflows.ts` when running from source (dev server,
 * tests), `workflows.js` in the build.
 */
const workflowsPath = fileURLToPath(
  new URL(`./workflows${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url),
);

/**
 * Compliance reports (spec 09): the Form M workspace endpoints and the reporting worker hosting
 * `ComplianceReportWorkflow` and its activities.
 */
@Module({
  imports: [
    ClockModule,
    CipherModule,
    UpstreamModule,
    TemporalWorkerModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowsPath,
      // One worker per service: every workflow of the reporting service runs on this queue.
      activities: [ComplianceReportActivities],
      imports: [ClockModule, CipherModule, UpstreamModule],
    }),
  ],
  controllers: [ComplianceReportsController],
  providers: [ComplianceReportsService, ReportWorkflows],
})
export class ComplianceReportsModule {}
