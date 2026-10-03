import { Module } from '@nestjs/common';

import { DeclarationsModule } from '../declarations/declarations.module.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { AssignmentService } from './assignment.service.js';
import { CaseAnnotationsService } from './case-annotations.service.js';
import { CaseViewService } from './case-view.service.js';
import { CasesController } from './cases.controller.js';
import { CompareController } from './compare.controller.js';
import { CompareService } from './compare.service.js';
import { QueueController } from './queue.controller.js';
import { QueueService } from './queue.service.js';
import { ReviewersService } from './reviewers.service.js';

/**
 * Review cases (spec 07a): the Commission's queue and its summary, version comparison, and work
 * on a case (view with the declaration pulled on demand, assignment, notes, flags reviewed).
 */
@Module({
  imports: [DeclarationsModule, DirectoryModule, DocumentsModule],
  controllers: [QueueController, CompareController, CasesController],
  providers: [
    QueueService,
    ReviewersService,
    CompareService,
    CaseViewService,
    AssignmentService,
    CaseAnnotationsService,
  ],
})
export class CasesModule {}
