import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ReadinessCheck } from '@adili/api-kit';

import { config } from '../config.js';

/** Injection token for the S3-compatible object storage client (ADR-002). */
export const S3 = Symbol('S3');

@Injectable()
export class S3ReadinessCheck extends ReadinessCheck implements OnApplicationShutdown {
  readonly name = 'object-storage';

  constructor(@Inject(S3) private readonly s3: S3Client) {
    super();
  }

  async check(): Promise<void> {
    await Promise.all(
      [config.S3_BUCKET_QUARANTINE, config.S3_BUCKET_CLEAN, config.S3_BUCKET_ISSUED].map((bucket) =>
        this.s3.send(new HeadBucketCommand({ Bucket: bucket })),
      ),
    );
  }

  onApplicationShutdown(): void {
    this.s3.destroy();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: S3,
      useFactory: () =>
        new S3Client({
          endpoint: config.S3_ENDPOINT,
          region: config.S3_REGION,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY,
          },
        }),
    },
    S3ReadinessCheck,
  ],
  exports: [S3, S3ReadinessCheck],
})
export class StorageModule {}
