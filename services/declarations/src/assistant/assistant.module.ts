import { Module } from '@nestjs/common';

import { AiGatewayModule } from '../ai-gateway/ai-gateway.module.js';
import { ClockModule } from '../clock.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { DraftsModule } from '../drafts/drafts.module.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { ConversationExpiry } from './expiry.js';
import { HintsController } from './hints.controller.js';
import { HintsService } from './hints.service.js';
import { ThemeCounts } from './theme-counts.js';
import { ThemesController } from './themes.controller.js';

/**
 * Ask Adili (spec 11): the declarant's conversations, answered through the ai-gateway from the
 * passages the help module retrieves, and deleted with the draft or once expired; the ratings of
 * answers, forwarded to the gateway; the summary hints; and the Commission's question counts.
 */
@Module({
  imports: [ClockModule, DirectoryModule, DraftsModule, AiGatewayModule],
  controllers: [AssistantController, HintsController, ThemesController],
  providers: [AssistantService, ConversationExpiry, HintsService, ThemeCounts],
})
export class AssistantModule {}
