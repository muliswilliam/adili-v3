import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { ActionApprovals } from './action-approvals.js';
import { DeclarantNoticesController } from './declarant-notices.controller.js';
import { DeclarantNoticesService } from './declarant-notices.service.js';
import { EnforcementConsumer } from './enforcement.consumer.js';
import { EnforcementController } from './enforcement.controller.js';
import { EnforcementService } from './enforcement.service.js';
import { EnforcementWorkflows } from './enforcement-workflows.js';
import { ActionLetterPayloadController } from './letter-payload.controller.js';
import { ActionLetterPayloadService } from './letter-payload.service.js';

/**
 * The enforcement ladder (spec 08, refines ADR-003): the consumers that start and close ladders
 * from obligation and clarification events, the staff's ladders and decisions, the declarant's
 * notices and responses, and the letter payload the documents service pulls.
 * `EnforcementWorkflow` and its activities run on the review worker (ProcessingModule). Exports
 * the actions' source of the approvals inbox.
 */
@Module({
  imports: [ClockModule, DirectoryModule, DocumentsModule],
  controllers: [
    EnforcementConsumer,
    EnforcementController,
    DeclarantNoticesController,
    ActionLetterPayloadController,
  ],
  providers: [
    EnforcementService,
    EnforcementWorkflows,
    DeclarantNoticesService,
    ActionLetterPayloadService,
    ActionApprovals,
  ],
  exports: [ActionApprovals],
})
export class EnforcementModule {}
