import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { BulkClosuresController } from './bulk-closures.controller.js';
import { BulkClosuresService } from './bulk-closures.service.js';
import { ClosureWorkflows } from './closure-workflows.js';

/**
 * Bulk closure (spec 08): the supervisors' summary and bulk approval of the system's closure
 * proposals, and the schedule of the daily closure sweep. The sweep and notices workflows and
 * their activities run on the review worker (ProcessingModule).
 */
@Module({
  imports: [ClockModule, DirectoryModule],
  controllers: [BulkClosuresController],
  providers: [BulkClosuresService, ClosureWorkflows],
})
export class ClosuresModule {}
