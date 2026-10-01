import { Module } from '@nestjs/common';

import { AdapterKitModule } from '../adapter-kit/adapter-kit.module.js';
import { Coverage } from './coverage.js';
import { IntegrationsController } from './integrations.controller.js';

/** Platform administrators' view of the registry integrations (`/v1/integrations`). */
@Module({
  imports: [AdapterKitModule],
  controllers: [IntegrationsController],
  providers: [Coverage],
})
export class IntegrationsModule {}
