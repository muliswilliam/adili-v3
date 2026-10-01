import { Module } from '@nestjs/common';

import {
  InternalRosterNationalIdController,
  InternalRosterRecordsController,
} from './internal-records.controller.js';
import { InternalRosterRecordsService } from './internal-records.service.js';
import { RosterRecordsController } from './records.controller.js';
import { RosterRecordsService } from './records.service.js';

/**
 * Reading a Commission's roster (spec #27): records, one record, and the summary; and the pulls
 * of services after roster events (spec 04), with a record's national ID on its own (spec 08).
 */
@Module({
  controllers: [
    RosterRecordsController,
    InternalRosterRecordsController,
    InternalRosterNationalIdController,
  ],
  providers: [RosterRecordsService, InternalRosterRecordsService],
})
export class RosterRecordsModule {}
