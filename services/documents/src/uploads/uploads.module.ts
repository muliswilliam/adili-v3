import { Module } from '@nestjs/common';

import { config } from '../config.js';
import { ClamdScanner, MalwareScanner } from '../scanning/malware-scanner.js';
import { UploadSweeper } from './upload-sweeper.js';
import { InternalUploadsController, UploadsController } from './uploads.controller.js';
import { COMPLETE_BUDGET_MS, UploadsService } from './uploads.service.js';

/** Presigned uploads with malware scanning, clean downloads and link markers for services. */
@Module({
  controllers: [UploadsController, InternalUploadsController],
  providers: [
    UploadsService,
    UploadSweeper,
    {
      provide: MalwareScanner,
      useFactory: () => new ClamdScanner(config.CLAMAV_HOST, config.CLAMAV_PORT),
    },
    { provide: COMPLETE_BUDGET_MS, useValue: 60_000 },
  ],
})
export class UploadsModule {}
