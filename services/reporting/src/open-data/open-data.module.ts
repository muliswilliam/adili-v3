import { Module } from '@nestjs/common';

import { ClockModule } from '../clock.module.js';
import { UpstreamModule } from '../upstream.module.js';
import { CommissionOpenDataPreviewController } from './commission-preview.controller.js';
import { CommissionOpenDataPreviewService } from './commission-preview.service.js';
import { OpenDataController } from './open-data.controller.js';
import { OpenDataService } from './open-data.service.js';
import { OpenDataReleaseBuilder } from './release-builder.js';
import { OpenDataReleasePublisher } from './release-publisher.js';

/**
 * Building, publishing and withdrawing open-data releases (`OpenDataReleaseBuilder`,
 * `OpenDataReleasePublisher`), for EACC's endpoints and the release workflow's activities on the
 * reporting worker. The dataset files go through `OpenDataFiles` (`OpenDataStorageModule`,
 * global); the manifest through documents.
 */
@Module({
  imports: [ClockModule, UpstreamModule],
  providers: [OpenDataReleaseBuilder, OpenDataReleasePublisher],
  exports: [OpenDataReleaseBuilder, OpenDataReleasePublisher],
})
export class OpenDataReleasesModule {}

/**
 * Open-data releases of the year's aggregates (spec 09b): EACC's endpoints to list them, build a
 * snapshot, publish and withdraw, and a commission-admin's preview of its own rows. The annual
 * release is published by `OpenDataReleaseWorkflow` on the NCR's approval.
 */
@Module({
  imports: [OpenDataReleasesModule],
  controllers: [OpenDataController, CommissionOpenDataPreviewController],
  providers: [OpenDataService, CommissionOpenDataPreviewService],
})
export class OpenDataModule {}
