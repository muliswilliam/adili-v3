import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { UploadsService } from './uploads.service.js';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Expires uploads whose presigned PUT ran out without a completion, every five minutes. Every
 * replica runs it; the sweep is idempotent (as api-kit's idempotency janitor).
 */
@Injectable()
export class UploadExpirySweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(UploadExpirySweeper.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly uploads: UploadsService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.uploads
        .expireStale()
        .then((count) => {
          if (count > 0) this.logger.log({ count }, 'Expired stale uploads');
        })
        .catch((error: unknown) => {
          this.logger.warn({ err: error }, 'Expiring stale uploads failed');
        });
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }
}
