import { Module } from '@nestjs/common';

import { ServiceObligationsService } from './obligations.service.js';
import {
  InternalObligationsController,
  InternalVersionsController,
} from './service-reads.controller.js';
import { ServiceVersionsService } from './versions.service.js';

/**
 * What other services read of declarations through its internal API: submitted versions for the
 * review service (spec 07a), obligations for its enforcement ladder and referral sweep (spec 08),
 * and the officers behind obligations for the reporting service's Form M (spec 09).
 */
@Module({
  controllers: [InternalVersionsController, InternalObligationsController],
  providers: [ServiceVersionsService, ServiceObligationsService],
})
export class ServiceReadsModule {}
