import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { UpstreamModule } from '../upstream.module.js';
import { NationalReportWorkflowsModule } from './national-report-workflows.js';
import { NationalReportsController } from './national-reports.controller.js';
import { NarrativeDraftService } from './narrative-draft.service.js';
import { NationalReportsService } from './national-reports.service.js';

/**
 * EACC's national consolidated report (spec 09 NCR): build, narrative (and its AI draft, spec
 * 09b) and approval. Its approval workflow runs on the reporting worker
 * (`ReportingWorkerModule`) with `NationalReportActivities`.
 */
@Module({
  imports: [ClockModule, UpstreamModule, NationalReportWorkflowsModule],
  controllers: [NationalReportsController],
  providers: [NationalReportsService, NarrativeDraftService],
})
export class NationalReportsModule {}
