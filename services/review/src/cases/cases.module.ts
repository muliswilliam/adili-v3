import { Module } from '@nestjs/common';

import { QueueController } from './queue.controller.js';
import { QueueService } from './queue.service.js';

/** Review cases (spec 07a): the Commission's queue and its summary. */
@Module({
  controllers: [QueueController],
  providers: [QueueService],
})
export class CasesModule {}
