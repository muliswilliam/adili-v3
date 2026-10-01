import { Module } from '@nestjs/common';

import { CipherModule } from '../cipher.module.js';
import { ClockModule } from '../clock.module.js';
import { RegisterModule } from '../register/access-register.js';
import { UpstreamModule } from '../upstream.module.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';

/**
 * Form K access requests (spec 10): submission so far; my requests, withdraw, the officer's
 * queue, resolution, representations and decisions join it, with `AccessRequestWorkflow` on the
 * access worker (`AccessWorkerModule`).
 */
@Module({
  imports: [ClockModule, CipherModule, UpstreamModule, RegisterModule],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
