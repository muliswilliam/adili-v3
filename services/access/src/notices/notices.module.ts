import { Module } from '@nestjs/common';

import { CipherModule } from '../cipher.module.js';
import { ClockModule } from '../clock.module.js';
import { RegisterModule } from '../register/access-register.js';
import { AccessRequestWorkflowsModule } from '../requests/request-workflows.js';
import { UpstreamModule } from '../upstream.module.js';
import { NoticesController } from './notices.controller.js';
import { NoticesService } from './notices.service.js';

/**
 * The declarant's side of access requests (spec 10, Act s.36(3)): the requests about them they
 * were notified of, and their representations. Who accessed their declaration and their certified
 * copies are `HistoryModule` and `SelfAccessModule`.
 */
@Module({
  imports: [
    ClockModule,
    CipherModule,
    UpstreamModule,
    RegisterModule,
    AccessRequestWorkflowsModule,
  ],
  controllers: [NoticesController],
  providers: [NoticesService],
})
export class NoticesModule {}
