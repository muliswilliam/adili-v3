import { Global, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ReadinessCheck } from '@adili/api-kit';

import { config } from '../config.js';
import { TrailModule } from '../trail/trail.module.js';
import { AnchorArchive, S3AnchorArchive } from './archive.js';
import { Anchoring } from './anchoring.js';
import { OpenBaoAnchorSigner } from './openbao-signer.js';
import { AnchoringSchedule } from './schedule.js';

/** The OpenBao connection the anchors are signed through. */
export const OPENBAO = { url: config.OPENBAO_ADDR, token: config.OPENBAO_TOKEN };

/** Ready while the `audit-archive` bucket answers. */
@Injectable()
export class AnchorArchiveReadinessCheck extends ReadinessCheck {
  readonly name = 'object-storage';

  constructor(private readonly archive: AnchorArchive) {
    super();
  }

  check(): Promise<void> {
    return this.archive.check();
  }
}

/** Closes the S3 client on shutdown. */
@Injectable()
class ArchiveLifecycle implements OnApplicationShutdown {
  constructor(private readonly archive: AnchorArchive) {}

  onApplicationShutdown(): void {
    if (this.archive instanceof S3AnchorArchive) this.archive.destroy();
  }
}

/**
 * The daily anchors: the signer (OpenBao Transit), the archive (`audit-archive` bucket), the
 * anchoring itself and its schedule. Global, so the worker's activities and the readiness checks
 * reach them. Clients connect lazily, so the module resolves without OpenBao or storage.
 */
@Global()
@Module({
  imports: [TrailModule],
  providers: [
    {
      provide: OpenBaoAnchorSigner,
      useFactory: () => new OpenBaoAnchorSigner({ ...OPENBAO, key: config.AUDIT_ANCHOR_KEY }),
    },
    {
      provide: AnchorArchive,
      useFactory: () =>
        new S3AnchorArchive(
          {
            endpoint: config.S3_ENDPOINT,
            region: config.S3_REGION,
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY,
          },
          config.S3_BUCKET_AUDIT_ARCHIVE,
        ),
    },
    Anchoring,
    AnchoringSchedule,
    AnchorArchiveReadinessCheck,
    ArchiveLifecycle,
  ],
  exports: [Anchoring, AnchorArchiveReadinessCheck, OpenBaoAnchorSigner, AnchorArchive],
})
export class AnchoringModule {}
