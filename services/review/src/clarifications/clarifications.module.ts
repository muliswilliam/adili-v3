import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { DeclarationsModule } from '../declarations/declarations.module.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { ClarificationDisclosureController } from './clarification-disclosure.controller.js';
import { ClarificationDisclosureService } from './clarification-disclosure.service.js';
import { ClarificationDetailsController } from './clarification-details.controller.js';
import { ClarificationDetailsService } from './clarification-details.service.js';
import { ClarificationWorkflows } from './clarification-workflows.js';
import { ClarificationsController } from './clarifications.controller.js';
import { ClarificationsService } from './clarifications.service.js';
import { DeclarantClarificationsController } from './declarant-clarifications.controller.js';
import { DeclarantClarificationsService } from './declarant-clarifications.service.js';
import { LetterPayloadController } from './letter-payload.controller.js';
import { LetterPayloadService } from './letter-payload.service.js';

/**
 * Clarifications (spec 07a): drafts, issue, resolve, follow-up and withdraw for the case's
 * assignee, the declarant's reads and response, the letter payload the documents service pulls,
 * and what an access grant discloses of them (spec 10). `ClarificationWorkflow` and its
 * activities run on the review worker (ProcessingModule).
 */
@Module({
  imports: [ClockModule, DeclarationsModule, DirectoryModule, DocumentsModule],
  controllers: [
    ClarificationsController,
    DeclarantClarificationsController,
    LetterPayloadController,
    ClarificationDetailsController,
    ClarificationDisclosureController,
  ],
  providers: [
    ClarificationsService,
    ClarificationWorkflows,
    DeclarantClarificationsService,
    LetterPayloadService,
    ClarificationDetailsService,
    ClarificationDisclosureService,
  ],
})
export class ClarificationsModule {}
