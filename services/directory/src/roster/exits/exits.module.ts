import { Module } from '@nestjs/common';

import { RosterExitsController } from './exits.controller.js';
import { RosterExitsService } from './exits.service.js';

/** Resolving records flagged absent (spec #27): confirming exits, or keeping the records. */
@Module({
  controllers: [RosterExitsController],
  providers: [RosterExitsService],
})
export class RosterExitsModule {}
