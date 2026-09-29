import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { DeclarantDecisionsController } from './declarant-decisions.controller.js';
import { DeclarantDecisionsService } from './declarant-decisions.service.js';
import { DeterminationApprovals } from './determination-approvals.js';
import { DeterminationLetterService } from './determination-letter.service.js';
import { DeterminationWorkflows } from './determination-workflows.js';
import { DeterminationsController } from './determinations.controller.js';
import { DeterminationsService } from './determinations.service.js';
import { DeterminationLetterPayloadController } from './letter-payload.controller.js';
import { DeterminationLetterPayloadService } from './letter-payload.service.js';

/**
 * Compliance determinations (spec 08): propose, approve, return and withdraw with separation of
 * duties, the declarant's decisions, and the letter payload the documents service pulls.
 * `DeterminationIssuanceWorkflow` and its activities run on the review worker (ProcessingModule).
 * Exports the determinations' source of the approvals inbox.
 */
@Module({
  imports: [ClockModule, DirectoryModule, DocumentsModule],
  controllers: [
    DeterminationsController,
    DeclarantDecisionsController,
    DeterminationLetterPayloadController,
  ],
  providers: [
    DeterminationsService,
    DeterminationLetterService,
    DeterminationWorkflows,
    DeterminationApprovals,
    DeclarantDecisionsService,
    DeterminationLetterPayloadService,
  ],
  exports: [DeterminationApprovals],
})
export class DeterminationsModule {}
