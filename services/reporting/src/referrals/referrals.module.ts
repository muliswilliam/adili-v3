import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { ReportWorkflowsModule } from '../compliance-reports/report-workflows.js';
import { UpstreamModule } from '../upstream.module.js';
import { ReferralsController } from './referrals.controller.js';
import { ReferralsService } from './referrals.service.js';

/**
 * EACC's referrals intake (spec 09): the list and the push to ICMS. The intake rows come from the
 * projections' `referral.sent.v1` consumer; the workflow that waits for a case number runs on the
 * reporting worker (compliance-reports module) with `ReferralIcmsActivities`.
 */
@Module({
  imports: [ClockModule, UpstreamModule, ReportWorkflowsModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
})
export class ReferralsModule {}
