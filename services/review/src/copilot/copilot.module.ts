import { Module } from '@nestjs/common';

import { AiGatewayModule } from '../ai-gateway/ai-gateway.module.js';
import { AiJobConsumer } from './ai-job.consumer.js';
import { AiStatusController } from './ai-status.controller.js';
import { CopilotController } from './copilot.controller.js';
import { CopilotRequestsModule } from './copilot-requests.module.js';
import { CopilotService } from './copilot.service.js';
import { CopilotWorkflows } from './copilot-workflows.js';

/**
 * The AI reviewer copilot of a case (spec 07c): its view and refresh, the `ai.job.*` consumer
 * that records the gateway's outputs, and the Commission's AI status. `requestCopilot` runs on the review worker
 * (processing.module.ts).
 */
@Module({
  imports: [AiGatewayModule, CopilotRequestsModule],
  controllers: [CopilotController, AiStatusController, AiJobConsumer],
  providers: [CopilotService, CopilotWorkflows],
})
export class CopilotModule {}
