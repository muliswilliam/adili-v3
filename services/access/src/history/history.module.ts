import { Module } from '@nestjs/common';

import { CipherModule } from '../cipher.module.js';
import { HistoryController } from './history.controller.js';
import { HistoryService } from './history.service.js';

/** "Who accessed my declaration": the access register as the declarant sees it (spec 10 S12). */
@Module({ imports: [CipherModule], controllers: [HistoryController], providers: [HistoryService] })
export class HistoryModule {}
