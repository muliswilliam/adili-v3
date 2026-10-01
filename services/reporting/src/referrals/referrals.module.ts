import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { UpstreamModule } from '../upstream.module.js';
import { ReferralWorkflowsModule } from './referral-workflows.js';
import { ReferralsController } from './referrals.controller.js';
import { ReferralsService } from './referrals.service.js';

/**
 * EACC's referrals intake (spec 09): the list and the push to ICMS. The intake rows come from the
 * projections' `referral.sent.v1` consumer; the workflow that waits for a case number runs on the
 * reporting worker (`ReportingWorkerModule`) with `ReferralIcmsActivities`.
 */
@Module({
  imports: [ClockModule, UpstreamModule, ReferralWorkflowsModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
})
export class ReferralsModule {}
