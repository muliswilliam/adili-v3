import { Module } from '@nestjs/common';

import { AiJobConsumer } from './ai-job.consumer.js';
import { CopilotController } from './copilot.controller.js';
import { CopilotRequestsModule } from './copilot-requests.module.js';
import { CopilotService } from './copilot.service.js';
import { CopilotWorkflows } from './copilot-workflows.js';

/**
 * The AI reviewer copilot of a case (spec 07c): its view and refresh, and the `ai.job.*` consumer
 * that records the gateway's outputs. `requestCopilot` runs on the review worker
 * (processing.module.ts).
 */
@Module({
  imports: [CopilotRequestsModule],
  controllers: [CopilotController, AiJobConsumer],
  providers: [CopilotService, CopilotWorkflows],
})
export class CopilotModule {}
