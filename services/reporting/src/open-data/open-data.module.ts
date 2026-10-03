import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { CommissionOpenDataPreviewController } from './commission-preview.controller.js';
import { CommissionOpenDataPreviewService } from './commission-preview.js';
import { OpenDataController } from './open-data.controller.js';
import { OpenDataService } from './open-data.service.js';
import { OpenDataReleaseBuilder } from './release-builder.js';

/**
 * Open-data releases of the year's aggregates (spec 09b): building them (`OpenDataReleaseBuilder`,
 * exported for the release workflow's activities), EACC's endpoints and a commission-admin's
 * preview of its own rows. The dataset files go
 * through `OpenDataFiles` (`OpenDataStorageModule`, global).
 */
@Module({
  imports: [ClockModule],
  controllers: [OpenDataController, CommissionOpenDataPreviewController],
  providers: [OpenDataReleaseBuilder, OpenDataService, CommissionOpenDataPreviewService],
  exports: [OpenDataReleaseBuilder],
})
export class OpenDataModule {}
