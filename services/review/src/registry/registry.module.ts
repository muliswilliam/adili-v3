import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { DeclarationsModule } from '../declarations/declarations.module.js';
import { IntegrationGatewayModule } from '../integration-gateway/integration-gateway.module.js';
import { RecheckService } from './recheck.service.js';
import { RegistryController } from './registry.controller.js';
import { RegistryViewService } from './registry-view.service.js';
import { RegistryWorkflows } from './registry-workflows.js';

/**
 * Registry cross-checks (spec 07b) on the API side: the Registry tab of a case, a re-check, and
 * the schedule of the hourly sweep of cases with a registry unavailable. The check and the sweep
 * (`RegistryCheckWorkflow`, `RegistryUnavailableSweep`) and their activities run on the review
 * worker (ProcessingModule).
 */
@Module({
  imports: [ClockModule, DeclarationsModule, IntegrationGatewayModule],
  controllers: [RegistryController],
  providers: [RegistryViewService, RecheckService, RegistryWorkflows],
})
export class RegistryModule {}
