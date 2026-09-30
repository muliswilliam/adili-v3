import { Module } from '@nestjs/common';

import { InternalRosterRecordsController } from './internal-records.controller.js';
import { InternalRosterRecordsService } from './internal-records.service.js';
import { RosterRecordsController } from './records.controller.js';
import { RosterRecordsService } from './records.service.js';

/**
 * Reading a Commission's roster (spec #27): records, one record, and the summary; and the pulls
 * of services after roster events (spec 04).
 */
@Module({
  controllers: [RosterRecordsController, InternalRosterRecordsController],
  providers: [RosterRecordsService, InternalRosterRecordsService],
})
export class RosterRecordsModule {}
