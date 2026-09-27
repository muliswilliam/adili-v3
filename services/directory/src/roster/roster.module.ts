import { Module } from '@nestjs/common';

import { RosterController } from './roster.controller.js';

/** A Commission's roster of expected declarants (spec 02). */
@Module({
  controllers: [RosterController],
})
export class RosterModule {}
