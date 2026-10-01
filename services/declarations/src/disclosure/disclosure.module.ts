import { Module } from '@nestjs/common';

import { InternalDisclosureController } from './disclosure.controller.js';
import { DisclosureService } from './disclosure.service.js';

/**
 * Disclosures of submitted declarations (spec 10): the scoped disclosure of an access grant and
 * the full document of a version for the declarant's certified copy, both audited reads.
 */
@Module({
  controllers: [InternalDisclosureController],
  providers: [DisclosureService],
})
export class DisclosureModule {}
