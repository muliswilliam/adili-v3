import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { RegisterModule } from '../register/access-register.js';
import { UpstreamModule } from '../upstream.module.js';
import { LeaController } from './lea.controller.js';
import { LeaService } from './lea.service.js';
import { LeaRequestWorkflowsModule } from './lea-workflows.js';

/**
 * Law enforcement requests (spec 10, Act s.36(2), Regs r.23): submission by provisioned agency
 * officers, their requests, and the Commission's verification and decision, with
 * `LeaRequestWorkflow` on the access worker (`AccessWorkerModule`). They join the Commission's
 * queue (`OfficerService`), their downloads the register (`DownloadsConsumer`) and their grants
 * the declarant's notices (`NoticesService`).
 */
@Module({
  imports: [ClockModule, UpstreamModule, RegisterModule, LeaRequestWorkflowsModule],
  controllers: [LeaController],
  providers: [LeaService],
})
export class LeaModule {}
