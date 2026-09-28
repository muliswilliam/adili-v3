import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ReadinessCheck } from '@adili/api-kit';

import { config } from '../config.js';

/** Injection token for the S3-compatible object storage client (ADR-002). */
export const S3 = Symbol('S3');

/**
 * Injection token for the client that presigns URLs browsers use: same storage, addressed by
 * its public endpoint (`S3_PUBLIC_ENDPOINT`), since the signature covers the host.
 */
export const S3_PUBLIC = Symbol('S3_PUBLIC');

function s3Client(endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: config.S3_REGION,
    forcePathStyle: true,
    // Checksums only where S3 requires them: a default checksum would be signed into presigned
    // PUTs as the checksum of an empty body, and not every S3 implementation returns them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
}

@Injectable()
export class S3ReadinessCheck extends ReadinessCheck implements OnApplicationShutdown {
  readonly name = 'object-storage';

  constructor(
    @Inject(S3) private readonly s3: S3Client,
    @Inject(S3_PUBLIC) private readonly publicS3: S3Client,
  ) {
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
    this.publicS3.destroy();
  }
}

@Global()
@Module({
  providers: [
    { provide: S3, useFactory: () => s3Client(config.S3_ENDPOINT) },
    {
      provide: S3_PUBLIC,
      useFactory: () => s3Client(config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT),
    },
    S3ReadinessCheck,
  ],
  exports: [S3, S3_PUBLIC, S3ReadinessCheck],
})
export class StorageModule {}
