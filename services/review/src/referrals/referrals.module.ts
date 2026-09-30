import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { DeclarationsModule } from '../declarations/declarations.module.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { ReferralIcmsPayloadController } from './icms-payload.controller.js';
import { ReferralIcmsPayloadService } from './icms-payload.service.js';
import { ReferralIcmsRegisteredConsumer } from './icms-registered.consumer.js';
import { ReferralPackagePayloadController } from './package-payload.controller.js';
import { ReferralPackagePayloadService } from './package-payload.service.js';
import { ReferralApprovals } from './referral-approvals.js';
import { ReferralWorkflows } from './referral-workflows.js';
import { ReferralsController } from './referrals.controller.js';
import { ReferralsService } from './referrals.service.js';

/**
 * Referrals to EACC (spec 08): reviewers' proposals, supervisors' approvals and declines, the
 * package payload the documents service pulls, the ICMS payload the reporting service pulls and
 * the ICMS case number it announces (spec 09), and the schedule of the daily referral sweep.
 * `ReferralSweep`, the sending of approved referrals and their activities run on the review worker
 * (ProcessingModule). Exports the referrals' source of the approvals inbox.
 */
@Module({
  imports: [ClockModule, DeclarationsModule, DirectoryModule, DocumentsModule],
  controllers: [
    ReferralsController,
    ReferralPackagePayloadController,
    ReferralIcmsPayloadController,
    ReferralIcmsRegisteredConsumer,
  ],
  providers: [
    ReferralsService,
    ReferralWorkflows,
    ReferralApprovals,
    ReferralPackagePayloadService,
    ReferralIcmsPayloadService,
  ],
  exports: [ReferralApprovals],
})
export class ReferralsModule {}
