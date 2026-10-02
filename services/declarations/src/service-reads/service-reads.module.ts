import { Module } from '@nestjs/common';

import { ServiceObligationsService } from './obligations.service.js';
import {
  InternalObligationsController,
  InternalPersonVersionsController,
  InternalVersionsController,
} from './service-reads.controller.js';
import { ServiceVersionsService } from './versions.service.js';

/**
 * What other services read of declarations through its internal API: submitted versions for the
 * review service (spec 07a), obligations for its enforcement ladder and referral sweep (spec 08),
 * the officers behind obligations for the reporting service's Form M (spec 09), and a person's
 * versions for the access service's certified copies (spec 10).
 */
@Module({
  controllers: [
    InternalVersionsController,
    InternalObligationsController,
    InternalPersonVersionsController,
  ],
  providers: [ServiceVersionsService, ServiceObligationsService],
})
export class ServiceReadsModule {}
