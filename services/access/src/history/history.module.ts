import { Module } from '@nestjs/common';

import { HistoryController } from './history.controller.js';
import { HistoryService } from './history.service.js';

/** "Who accessed my declaration": the access register as the declarant sees it (spec 10 S12). */
@Module({ controllers: [HistoryController], providers: [HistoryService] })
export class HistoryModule {}
