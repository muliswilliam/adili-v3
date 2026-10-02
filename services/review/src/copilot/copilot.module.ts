import { Module } from '@nestjs/common';

import { AiGatewayModule } from '../ai-gateway/ai-gateway.module.js';
import { DeclarationsModule } from '../declarations/declarations.module.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { AiJobConsumer } from './ai-job.consumer.js';
import { AiStatusController } from './ai-status.controller.js';
import { CopilotController } from './copilot.controller.js';
import { CopilotDraftPurge } from './copilot-draft-purge.js';
import { CopilotDraftsController } from './copilot-drafts.controller.js';
import { CopilotDraftsService } from './copilot-drafts.service.js';
import { CopilotFeedback } from './copilot-feedback.js';
import { CopilotFeedbackController } from './copilot-feedback.controller.js';
import { CopilotRequestsModule } from './copilot-requests.module.js';
import { CopilotService } from './copilot.service.js';
import { CopilotWorkflows } from './copilot-workflows.js';

/**
 * The AI reviewer copilot of a case (spec 07c): its view, refresh and ratings, clarification
 * drafts, the `ai.job.*` consumer that records the gateway's outputs, and the Commission's AI
 * status. `requestCopilot` runs on the review worker (processing.module.ts).
 */
@Module({
  imports: [AiGatewayModule, CopilotRequestsModule, DeclarationsModule, DirectoryModule],
  controllers: [
    CopilotController,
    CopilotDraftsController,
    CopilotFeedbackController,
    AiStatusController,
    AiJobConsumer,
  ],
  providers: [
    CopilotService,
    CopilotFeedback,
    CopilotWorkflows,
    CopilotDraftsService,
    CopilotDraftPurge,
  ],
})
export class CopilotModule {}
