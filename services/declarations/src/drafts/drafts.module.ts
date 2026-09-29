import { Module } from '@nestjs/common';

import { DirectoryModule } from '../directory/directory.module.js';
import { DraftsController } from './drafts.controller.js';
import { DraftsService } from './drafts.service.js';
import { SectionCipher } from './section-cipher.js';

/**
 * Declaration drafts (spec 05): started from a filing obligation, captured section by section,
 * each section encrypted with the Commission's key (`FieldCipher`, provided by the app).
 */
@Module({
  imports: [DirectoryModule],
  controllers: [DraftsController],
  providers: [DraftsService, SectionCipher],
})
export class DraftsModule {}
