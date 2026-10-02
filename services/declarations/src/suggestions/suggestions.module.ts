import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.js';
import { DraftsModule } from '../drafts/drafts.module.js';
import { RegistryLookupsModule } from './registry-lookups.module.js';
import {
  RegistryLookupWorkflows,
  TemporalRegistryLookupWorkflows,
} from './registry-lookup-workflows.js';
import { SuggestionsController } from './suggestions.controller.js';
import { SuggestionsService } from './suggestions.service.js';

/**
 * Registry pre-fill suggestions (spec 05b): consent, lookups through the integration-gateway in
 * `RegistryLookupsWorkflow` (on the declarations worker, see `ObligationsModule`), and the
 * declarant's list of what came back, encrypted with the draft.
 */
@Module({
  imports: [ClockModule, DraftsModule, RegistryLookupsModule],
  controllers: [SuggestionsController],
  providers: [
    SuggestionsService,
    { provide: RegistryLookupWorkflows, useClass: TemporalRegistryLookupWorkflows },
  ],
})
export class SuggestionsModule {}
