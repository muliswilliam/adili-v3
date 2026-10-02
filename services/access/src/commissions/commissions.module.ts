import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { UpstreamModule } from '../upstream.module.js';
import { CommissionsController } from './commissions.controller.js';
import { CommissionsService } from './commissions.service.js';

/** The Responsible Commissions applicants address Form K to, from the directory (spec 10). */
@Module({
  imports: [ClockModule, UpstreamModule],
  controllers: [CommissionsController],
  providers: [CommissionsService],
})
export class CommissionsModule {}
