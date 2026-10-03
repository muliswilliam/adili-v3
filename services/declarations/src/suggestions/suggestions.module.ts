import { Module } from '@nestjs/common';

import { AiGatewayModule } from '../ai-gateway/ai-gateway.module.js';
import { ClockModule } from '../clock.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { DraftsModule } from '../drafts/drafts.module.js';
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
 * documents read through the ai-gateway (requested here, settled by its `ai.job.*` events), and
 * the declarant's list of what came back, encrypted with the draft.
 */
@Module({
  imports: [AiGatewayModule, ClockModule, DocumentsModule, DraftsModule, RegistryLookupsModule],
  controllers: [SuggestionsController, ExtractionController, ExtractionJobConsumer],
  providers: [
    SuggestionsService,
    ExtractionService,
    { provide: RegistryLookupWorkflows, useClass: TemporalRegistryLookupWorkflows },
  ],
})
export class SuggestionsModule {}
