import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.js';
import { DraftsModule } from '../drafts/drafts.module.js';
import { ObligationWorkflowsModule } from '../obligations/workflow/obligation-workflows.module.js';
import { SubmissionController } from './submission.controller.js';
import { SubmissionService } from './submission.service.js';

/**
 * Submission (spec 06): the legal act that turns a draft into an immutable, numbered version and
 * files its obligation.
 */
@Module({
  imports: [ClockModule, DraftsModule, ObligationWorkflowsModule],
  controllers: [SubmissionController],
  providers: [SubmissionService],
})
export class SubmissionModule {}
