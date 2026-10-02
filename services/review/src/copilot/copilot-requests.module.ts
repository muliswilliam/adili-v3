import { Module } from '@nestjs/common';

import { AiGatewayModule } from '../ai-gateway/ai-gateway.module.js';
import { CipherModule } from '../cipher.module.js';
import { DeclarationsModule } from '../declarations/declarations.module.js';
import { CopilotRequests } from './copilot-requests.js';

/** `CopilotRequests` with what it calls, for the HTTP module and the worker's activities alike. */
@Module({
  imports: [AiGatewayModule, CipherModule, DeclarationsModule],
  providers: [CopilotRequests],
  exports: [CopilotRequests, CipherModule],
})
export class CopilotRequestsModule {}
