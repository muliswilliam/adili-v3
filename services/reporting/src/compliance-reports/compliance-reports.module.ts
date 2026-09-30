import { Module } from '@nestjs/common';

import { CipherModule } from '../cipher.module.js';
import { ClockModule } from '../clock.module.js';
import { UpstreamModule } from '../upstream.module.js';
import { AnnualCompileSchedule } from './annual-compile-schedule.js';
import { ComplianceReportsController } from './compliance-reports.controller.js';
import { ComplianceReportsService } from './compliance-reports.service.js';
import { EaccReportsController } from './eacc-reports.controller.js';
import { EaccReportsService } from './eacc-reports.service.js';
import { FederatedReportsController } from './federated-reports.controller.js';
import { NationalChaseSchedule } from './national-chase-schedule.js';
import { ReportSignOffService } from './report-sign-off.service.js';
import { ReportWorkflowsModule } from './report-workflows.js';

/**
 * Compliance reports (spec 09): the Form M workspace endpoints, federated submission, EACC's
 * intake and report viewer, and the schedules of the yearly compile and of EACC's chase. Their
 * workflows run on the reporting worker (`ReportingWorkerModule`).
 */
@Module({
  imports: [ClockModule, CipherModule, UpstreamModule, ReportWorkflowsModule],
  controllers: [ComplianceReportsController, FederatedReportsController, EaccReportsController],
  providers: [
    ComplianceReportsService,
    ReportSignOffService,
    EaccReportsService,
    AnnualCompileSchedule,
    NationalChaseSchedule,
  ],
})
export class ComplianceReportsModule {}
