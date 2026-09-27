import { Module } from '@nestjs/common';

import { CommissionsController, ReferenceController } from './commissions.controller.js';
import { CommissionsService } from './commissions.service.js';
import { ReportingOfficersService } from './reporting-officers.service.js';

/** Responsible Commissions: the tenants of the platform and their reporting officers (spec 01). */
@Module({
  controllers: [CommissionsController, ReferenceController],
  providers: [CommissionsService, ReportingOfficersService],
})
export class CommissionsModule {}
