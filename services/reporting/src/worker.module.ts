import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { TemporalWorkerModule } from '@adili/temporal';

import { CipherModule } from './cipher.module.js';
import { ClockModule } from './clock.module.js';
import { ComplianceReportActivities } from './compliance-reports/activities.js';
import { AnnualCompileActivities } from './compliance-reports/annual-compile-activities.js';
import { NationalChaseActivities } from './compliance-reports/national-chase-activities.js';
import { ReportWorkflowsModule } from './compliance-reports/report-workflows.js';
import { config } from './config.js';
import { NationalReportActivities } from './national-reports/activities.js';
import { ReferralIcmsActivities } from './referrals/activities.js';
import { UpstreamModule } from './upstream.module.js';

/**
 * The workflows entry next to this file: `workflows.ts` when running from source (dev server,
 * tests), `workflows.js` in the build.
 */
const workflowsPath = fileURLToPath(
  new URL(`./workflows${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url),
);

/**
 * The reporting worker (ADR-003), one per service: every workflow of the reporting service runs
 * on its queue. It hosts `ComplianceReportWorkflow`, the yearly compile,
 * `NationalConsolidationWorkflow`, `NationalReportApprovalWorkflow`,
 * `ReferralIcmsRegistrationWorkflow` and their activities.
 */
@Module({
  imports: [
    TemporalWorkerModule.forRoot({
      address: config.TEMPORAL_ADDRESS,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowsPath,
      activities: [
        ComplianceReportActivities,
        AnnualCompileActivities,
        NationalChaseActivities,
        NationalReportActivities,
        ReferralIcmsActivities,
      ],
      imports: [ClockModule, CipherModule, UpstreamModule, ReportWorkflowsModule],
    }),
  ],
})
export class ReportingWorkerModule {}
