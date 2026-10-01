import { Module } from '@nestjs/common';

import { DeclarationsModule } from '../declarations/declarations.module.js';
import { IntegrationGatewayModule } from '../integration-gateway/integration-gateway.module.js';
import { RegistryController } from './registry.controller.js';
import { RegistryViewService } from './registry-view.service.js';

/**
 * Registry cross-checks (spec 07b) on the API side: the Registry tab of a case. The check itself
 * (`RegistryCheckWorkflow` and its activities) runs on the review worker (ProcessingModule).
 */
@Module({
  imports: [DeclarationsModule, IntegrationGatewayModule],
  controllers: [RegistryController],
  providers: [RegistryViewService],
})
export class RegistryModule {}
