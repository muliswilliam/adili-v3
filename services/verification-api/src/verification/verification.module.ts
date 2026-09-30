import { Module } from '@nestjs/common';

import { ProjectionConsumer } from './projection.consumer.js';
import { VerificationProjection } from './projection.js';
import { VerifyController } from './verify.controller.js';
import { VerifyService } from './verify.service.js';

@Module({
  controllers: [VerifyController, ProjectionConsumer],
  providers: [VerificationProjection, VerifyService],
})
export class VerificationModule {}
