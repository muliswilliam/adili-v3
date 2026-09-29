import { Module } from '@nestjs/common';

import { DeclarationsModule } from '../declarations/declarations.module.js';
import { CompareController } from './compare.controller.js';
import { CompareService } from './compare.service.js';
import { QueueController } from './queue.controller.js';
import { QueueService } from './queue.service.js';

/** Review cases (spec 07a): the Commission's queue and its summary, and version comparison. */
@Module({
  imports: [DeclarationsModule],
  controllers: [QueueController, CompareController],
  providers: [QueueService, CompareService],
})
export class CasesModule {}
