import { Module } from '@nestjs/common';

import { CipherModule } from '../cipher.module.js';
import { ClockModule } from '../clock.module.js';
import { RegisterModule } from '../register/access-register.js';
import { UpstreamModule } from '../upstream.module.js';
import { AcknowledgementConsumer } from './acknowledgement.consumer.js';
import { AcknowledgementService } from './acknowledgement.service.js';
import { ApplicantVerificationController } from './applicant-verification.controller.js';
import { ApplicantVerificationService } from './applicant-verification.service.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';

/**
 * Form K access requests (spec 10): submission and its acknowledgement, the applicant's requests
 * and withdrawal, and the access officer's verification of passport applicants; the officer's
 * queue, resolution, representations and decisions join it, with `AccessRequestWorkflow` on the
 * access worker (`AccessWorkerModule`).
 */
@Module({
  imports: [ClockModule, CipherModule, UpstreamModule, RegisterModule],
  controllers: [RequestsController, ApplicantVerificationController, AcknowledgementConsumer],
  providers: [RequestsService, ApplicantVerificationService, AcknowledgementService],
})
export class RequestsModule {}
