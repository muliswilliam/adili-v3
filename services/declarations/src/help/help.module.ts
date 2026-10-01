import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.js';
import { CorpusFiles, CorpusImporter } from './corpus-importer.js';
import { HelpController } from './help.controller.js';
import { HelpService } from './help.service.js';

/**
 * Help (spec 11): the statutory corpus (imported from `corpus/*.json` on boot), help articles, and
 * deterministic full-text retrieval over both, which help search and the assistant use.
 */
@Module({
  imports: [ClockModule],
  controllers: [HelpController],
  providers: [HelpService, CorpusFiles, CorpusImporter],
  exports: [HelpService],
})
export class HelpModule {}
