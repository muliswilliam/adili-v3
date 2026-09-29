import { Module } from '@nestjs/common';

import { Clock, SystemClock } from '../clock.js';
import { DeclarationsModule } from '../declarations/declarations.module.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { ClarificationWorkflows } from './clarification-workflows.js';
import { ClarificationsController } from './clarifications.controller.js';
import { ClarificationsService } from './clarifications.service.js';
import { DeclarantClarificationsController } from './declarant-clarifications.controller.js';
import { DeclarantClarificationsService } from './declarant-clarifications.service.js';
import { LetterPayloadController } from './letter-payload.controller.js';
import { LetterPayloadService } from './letter-payload.service.js';

/**
 * Clarifications (spec 07a): drafts and issue for the case's assignee, the declarant's reads, and
 * the letter payload the documents service pulls. `ClarificationWorkflow` and its activities run
 * on the review worker (ProcessingModule).
 */
@Module({
  imports: [DeclarationsModule, DirectoryModule],
  controllers: [
    ClarificationsController,
    DeclarantClarificationsController,
    LetterPayloadController,
  ],
  providers: [
    { provide: Clock, useClass: SystemClock },
    ClarificationsService,
    ClarificationWorkflows,
    DeclarantClarificationsService,
    LetterPayloadService,
  ],
})
export class ClarificationsModule {}
