import { Module } from '@nestjs/common';

import { CipherModule } from '../cipher.module.js';
import { ClockModule } from '../clock.module.js';
import { RegisterModule } from '../register/access-register.js';
import { UpstreamModule } from '../upstream.module.js';
import { AcknowledgementConsumer } from './acknowledgement.consumer.js';
import { AcknowledgementService } from './acknowledgement.service.js';
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
 * officer a request names, its decision and the downloads of its package, with `AccessRequestWorkflow` on the access
 * worker (`AccessWorkerModule`).
 */
@Module({
  imports: [
    ClockModule,
    CipherModule,
    UpstreamModule,
    RegisterModule,
    AccessRequestWorkflowsModule,
  ],
  controllers: [
    RequestsController,
    OfficerController,
    ApplicantVerificationController,
    AcknowledgementConsumer,
    DownloadsConsumer,
  ],
  providers: [
    RequestsService,
    OfficerService,
    ApplicantVerificationService,
    AcknowledgementService,
  ],
})
export class RequestsModule {}
