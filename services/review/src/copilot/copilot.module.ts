import { Module } from '@nestjs/common';

import { AiGatewayModule } from '../ai-gateway/ai-gateway.module.js';
import { AiJobConsumer } from './ai-job.consumer.js';
import { CopilotController } from './copilot.controller.js';
import { CopilotFeedback } from './copilot-feedback.js';
import { CopilotFeedbackController } from './copilot-feedback.controller.js';
import { CopilotRequestsModule } from './copilot-requests.module.js';
import { CopilotService } from './copilot.service.js';
import { CopilotWorkflows } from './copilot-workflows.js';

/**
 * The AI reviewer copilot of a case (spec 07c): its view, refresh and ratings, and the `ai.job.*` consumer
 * that records the gateway's outputs. `requestCopilot` runs on the review worker
 * (processing.module.ts).
 */
@Module({
  imports: [AiGatewayModule, CopilotRequestsModule],
  controllers: [CopilotController, CopilotFeedbackController, AiJobConsumer],
  providers: [CopilotService, CopilotFeedback, CopilotWorkflows],
})
export class CopilotModule {}
