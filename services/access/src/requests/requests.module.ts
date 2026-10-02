import { Module } from '@nestjs/common';

import { CipherModule } from '../cipher.module.js';
import { ClockModule } from '../clock.module.js';
import { LeaRequestWorkflowsModule } from '../lea/lea-workflows.js';
import { OnboardedNoticeWorkflowsModule } from '../onboarded-notices/onboarded-notice-workflows.js';
import { RegisterModule } from '../register/access-register.js';
import { UpstreamModule } from '../upstream.module.js';
import { AcknowledgementConsumer } from './acknowledgement.consumer.js';
import { AcknowledgementService } from './acknowledgement.service.js';
import { DeclarantOnboardedConsumer } from './declarant-onboarded.consumer.js';
import { DownloadsConsumer } from './downloads.consumer.js';
import { ApplicantVerificationController } from './applicant-verification.controller.js';
import { ApplicantVerificationService } from './applicant-verification.service.js';
import { OfficerController } from './officer.controller.js';
import { OfficerService } from './officer.service.js';
import { AccessRequestWorkflowsModule } from './request-workflows.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';

/**
 * Form K access requests (spec 10): submission and its acknowledgement, the applicant's requests
 * and withdrawal; the officer's queue, verification of passport applicants and resolution of the
 * officer a request names (with the written notice and representations received in writing of an
 * officer who has no account, linked to them once they onboard), its decision and the downloads
 * of its package, with `AccessRequestWorkflow` on the access worker (`AccessWorkerModule`).
 */
@Module({
  imports: [
    ClockModule,
    CipherModule,
    UpstreamModule,
    RegisterModule,
    AccessRequestWorkflowsModule,
    LeaRequestWorkflowsModule,
    OnboardedNoticeWorkflowsModule,
  ],
  controllers: [
    RequestsController,
    OfficerController,
    ApplicantVerificationController,
    AcknowledgementConsumer,
    DownloadsConsumer,
    DeclarantOnboardedConsumer,
  ],
  providers: [
    RequestsService,
    OfficerService,
    ApplicantVerificationService,
    AcknowledgementService,
  ],
})
export class RequestsModule {}
