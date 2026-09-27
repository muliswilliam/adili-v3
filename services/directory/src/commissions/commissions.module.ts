import { Module } from '@nestjs/common';

import { CommissionsController, ReferenceController } from './commissions.controller.js';
import { CommissionsService } from './commissions.service.js';

/** Responsible Commissions: the tenants of the platform and their reporting officers (spec 01). */
@Module({
  controllers: [CommissionsController, ReferenceController],
  providers: [CommissionsService],
})
export class CommissionsModule {}
