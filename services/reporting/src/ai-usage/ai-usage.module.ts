import { Module } from '@nestjs/common';

import { AiUsageController } from './ai-usage.controller.js';
import { AiUsageService } from './ai-usage.service.js';

/** EACC's read of the AI reviewer copilot's counts per Commission (spec 07c story 19). */
@Module({ controllers: [AiUsageController], providers: [AiUsageService] })
export class AiUsageModule {}
