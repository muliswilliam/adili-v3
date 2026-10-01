import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { DraftsModule } from '../drafts/drafts.module.js';
import { ObligationWorkflowsModule } from '../obligations/workflow/obligation-workflows.module.js';
import { AmendmentService } from './amendment.service.js';
import { SubmissionController } from './submission.controller.js';
import { SubmissionService } from './submission.service.js';

/**
 * Submission (spec 06): the legal act that turns a draft into an immutable, numbered version and
 * files its obligation; amendments reopening it until the due date; its versions.
 */
@Module({
  imports: [ClockModule, DocumentsModule, DraftsModule, ObligationWorkflowsModule],
  controllers: [SubmissionController],
  providers: [SubmissionService, AmendmentService],
})
export class SubmissionModule {}
