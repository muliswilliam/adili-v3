import { Module } from '@nestjs/common';

import { AiGatewayModule } from '../ai-gateway/ai-gateway.module.js';
import { DeclarationsModule } from '../declarations/declarations.module.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { AiJobConsumer } from './ai-job.consumer.js';
import { CopilotController } from './copilot.controller.js';
import { CopilotDraftPurge } from './copilot-draft-purge.js';
import { CopilotDraftsController } from './copilot-drafts.controller.js';
import { CopilotDraftsService } from './copilot-drafts.service.js';
import { CopilotRequestsModule } from './copilot-requests.module.js';
import { CopilotService } from './copilot.service.js';
import { CopilotWorkflows } from './copilot-workflows.js';

/**
 * The AI reviewer copilot of a case (spec 07c): its view and refresh, the `ai.job.*` consumer
 * that records the gateway's outputs, and clarification drafts. `requestCopilot` runs on the
 * review worker (processing.module.ts).
 */
@Module({
  imports: [CopilotRequestsModule, AiGatewayModule, DeclarationsModule, DirectoryModule],
  controllers: [CopilotController, CopilotDraftsController, AiJobConsumer],
  providers: [CopilotService, CopilotWorkflows, CopilotDraftsService, CopilotDraftPurge],
})
export class CopilotModule {}
