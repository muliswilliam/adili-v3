import { Module } from '@nestjs/common';

import { RosterRecordsController } from './records.controller.js';
import { RosterRecordsService } from './records.service.js';

/** Reading a Commission's roster (spec #27): records, one record, and the summary. */
@Module({
  controllers: [RosterRecordsController],
  providers: [RosterRecordsService],
})
export class RosterRecordsModule {}
