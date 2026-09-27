import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { ActivationLookups, ValkeyActivationLookups } from './activation-lookups.js';
import { ActivationObserver } from './activation-observer.js';
import { CommissionsController, ReferenceController } from './commissions.controller.js';
import { CommissionsService } from './commissions.service.js';
import { ReportingOfficersService } from './reporting-officers.service.js';

/** Responsible Commissions: the tenants of the platform and their reporting officers (spec 01). */
@Module({
  controllers: [CommissionsController, ReferenceController],
  providers: [
    CommissionsService,
    ReportingOfficersService,
    { provide: ActivationLookups, useClass: ValkeyActivationLookups },
    // Every authenticated request of the service, not only this module's routes (S13: `/v1/me`).
    { provide: APP_INTERCEPTOR, useClass: ActivationObserver },
  ],
})
export class CommissionsModule {}
