import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { AttachmentsController } from './attachments.controller.js';
import { AttachmentsService } from './attachments.service.js';
import { DraftsController } from './drafts.controller.js';
import { DraftsService } from './drafts.service.js';
import { SectionCipher } from './section-cipher.js';

/**
 * Declaration drafts (spec 05): started from a filing obligation, captured section by section,
 * each section encrypted with the Commission's key (`FieldCipher`, provided by the app), with
 * attachments on statement items held by the documents service.
 */
@Module({
  imports: [ClockModule, DirectoryModule, DocumentsModule],
  controllers: [DraftsController, AttachmentsController],
  providers: [DraftsService, AttachmentsService, SectionCipher],
})
export class DraftsModule {}
