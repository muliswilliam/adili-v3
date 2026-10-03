import { Module } from '@nestjs/common';

import { Coverage } from './coverage.js';
import { IntegrationSettings } from './integration-settings.js';
import { IntegrationsController } from './integrations.controller.js';

/** Platform administrators' view of the registry integrations, and their pauses (`/v1/integrations`). */
@Module({
  controllers: [IntegrationsController],
  providers: [Coverage, IntegrationSettings],
})
export class IntegrationsModule {}
