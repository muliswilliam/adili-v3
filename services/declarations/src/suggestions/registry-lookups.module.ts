import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { DraftsModule } from '../drafts/drafts.module.js';
import { IntegrationGatewayModule } from '../integration-gateway/integration-gateway.module.js';
import { RegistryLookupSteps } from './registry-lookup-steps.js';
import { SuggestionCipher } from './suggestion-cipher.js';

/**
 * What the registry lookup workflow's activities need (spec 05b): the person's national ID from
 * the directory or Household, the integration-gateway, and the suggestions' encryption. Imported
 * by the worker (`ObligationsModule`) and by the suggestions routes.
 */
@Module({
  imports: [ClockModule, DirectoryModule, DraftsModule, IntegrationGatewayModule],
  providers: [RegistryLookupSteps, SuggestionCipher],
  exports: [RegistryLookupSteps, SuggestionCipher],
})
export class RegistryLookupsModule {}
