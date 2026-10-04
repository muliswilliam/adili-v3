import { Module } from '@nestjs/common';

import { config } from '../config.js';
import { PublicOpenDataController } from './public-open-data.controller.js';
import { PublicOpenDataService, VERIFY_BASE_URL } from './public-open-data.service.js';

/**
 * The public open-data API (spec 09b): published and withdrawn releases and their tables, read
 * through `OpenDataFiles` (`OpenDataStorageModule`, global), for anyone, rate-limited per client
 * IP (`RateLimitModule`).
 */
@Module({
  controllers: [PublicOpenDataController],
  providers: [
    PublicOpenDataService,
    { provide: VERIFY_BASE_URL, useValue: config.VERIFY_BASE_URL },
  ],
})
export class PublicOpenDataModule {}
