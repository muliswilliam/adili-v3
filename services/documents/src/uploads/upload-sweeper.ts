import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { UploadsService } from './uploads.service.js';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Every five minutes, expires uploads whose presigned PUT ran out without a completion and
 * deletes clean uploads left without a link for 30 days. Every replica runs it; both sweeps are
 * idempotent (as api-kit's idempotency janitor).
 */
@Injectable()
export class UploadSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(UploadSweeper.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly uploads: UploadsService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.sweep();
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    try {
      const count = await this.uploads.expireStale();
      if (count > 0) this.logger.log({ count }, 'Expired stale uploads');
    } catch (error) {
      this.logger.warn({ err: error }, 'Expiring stale uploads failed');
    }
    try {
      const count = await this.uploads.sweepOrphans();
      if (count > 0) this.logger.log({ count }, 'Deleted orphaned uploads');
    } catch (error) {
      this.logger.warn({ err: error }, 'Deleting orphaned uploads failed');
    }
  }
}
