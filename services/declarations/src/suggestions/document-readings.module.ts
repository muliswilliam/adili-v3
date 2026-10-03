import { Module } from '@nestjs/common';

import { AiGatewayModule } from '../ai-gateway/ai-gateway.module.js';
import { ClockModule } from '../clock.js';
import { DocumentReadingSteps } from './document-reading-steps.js';
import { RegistryLookupsModule } from './registry-lookups.module.js';

/**
 * What settling a document's reading needs (spec 05b S6): the ai-gateway's jobs and the
 * suggestions' encryption. Imported by the worker (`ObligationsModule`), for the reading
 * workflow's activities, and by the suggestions routes.
 */
@Module({
  imports: [AiGatewayModule, ClockModule, RegistryLookupsModule],
  providers: [DocumentReadingSteps],
  exports: [DocumentReadingSteps, AiGatewayModule],
})
export class DocumentReadingsModule {}
