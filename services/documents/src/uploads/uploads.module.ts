import { Module } from '@nestjs/common';

import { config } from '../config.js';
import { ClamdScanner, MalwareScanner } from '../scanning/malware-scanner.js';
import { UploadExpirySweeper } from './expiry-sweeper.js';
import { InternalUploadsController, UploadsController } from './uploads.controller.js';
import { COMPLETE_BUDGET_MS, UploadsService } from './uploads.service.js';

/** Presigned uploads with malware scanning, and clean downloads for services (spec 02). */
@Module({
  controllers: [UploadsController, InternalUploadsController],
  providers: [
    UploadsService,
    UploadExpirySweeper,
    {
      provide: MalwareScanner,
      useFactory: () => new ClamdScanner(config.CLAMAV_HOST, config.CLAMAV_PORT),
    },
    { provide: COMPLETE_BUDGET_MS, useValue: 60_000 },
  ],
})
export class UploadsModule {}
