import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { DraftsModule } from '../drafts/drafts.module.js';
import { DocumentReadingsModule } from './document-readings.module.js';
import {
  DocumentReadingWorkflows,
  TemporalDocumentReadingWorkflows,
} from './document-reading-workflows.js';
import { ExtractionController } from './extraction.controller.js';
import { ExtractionService } from './extraction.service.js';
import { ExtractionJobConsumer } from './extraction-job.consumer.js';
import { RegistryLookupsModule } from './registry-lookups.module.js';
import {
  RegistryLookupWorkflows,
  TemporalRegistryLookupWorkflows,
} from './registry-lookup-workflows.js';
import { SuggestionsController } from './suggestions.controller.js';
import { SuggestionsService } from './suggestions.service.js';

/**
 * Pre-fill suggestions (spec 05b): consent, lookups through the integration-gateway in
 * `RegistryLookupsWorkflow` (on the declarations worker, see `ObligationsModule`), attached
 * documents read through the ai-gateway (requested here, settled by `DocumentReadingWorkflow` on
 * the job's `ai.job.*` event or by pulling), and the declarant's list of what came back,
 * encrypted with the draft.
 */
@Module({
  imports: [
    ClockModule,
    DocumentReadingsModule,
    DocumentsModule,
    DraftsModule,
    RegistryLookupsModule,
  ],
  controllers: [SuggestionsController, ExtractionController, ExtractionJobConsumer],
  providers: [
    SuggestionsService,
    ExtractionService,
    { provide: RegistryLookupWorkflows, useClass: TemporalRegistryLookupWorkflows },
    { provide: DocumentReadingWorkflows, useClass: TemporalDocumentReadingWorkflows },
  ],
})
export class SuggestionsModule {}
