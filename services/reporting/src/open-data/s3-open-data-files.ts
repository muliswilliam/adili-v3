import {
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ReadinessCheck } from '@adili/api-kit';

import { config } from '../config.js';
import {
  OpenDataFileMissing,
  OpenDataFiles,
  OpenDataStorageUnavailable,
} from './open-data-files.js';

/** Injection token for the S3-compatible object storage client (ADR-002). */
export const S3 = Symbol('S3');

export function s3Client(options: {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): S3Client {
  return new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: true,
    // Checksums only where S3 requires them, as the documents service does: not every S3
    // implementation returns them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
  });
}

/** `OpenDataFiles` on an S3 bucket. */
export class S3OpenDataFiles extends OpenDataFiles {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {
    super();
  }

  async put(file: { key: string; body: Uint8Array; contentType: string }): Promise<void> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: file.key,
          Body: file.body,
          ContentType: file.contentType,
        }),
      );
    } catch (error) {
      throw new OpenDataStorageUnavailable(`Could not write ${file.key}`, { cause: error });
    }
  }

  async get(key: string): Promise<Uint8Array> {
    try {
      const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!object.Body) throw new OpenDataFileMissing(`No object ${key}`);
      return await object.Body.transformToByteArray();
    } catch (error) {
      if (error instanceof OpenDataFileMissing) throw error;
      if (error instanceof NoSuchKey) throw new OpenDataFileMissing(`No object ${key}`);
      throw new OpenDataStorageUnavailable(`Could not read ${key}`, { cause: error });
    }
  }
}

/** Ready while the open-data bucket answers. */
@Injectable()
export class OpenDataStorageReadinessCheck extends ReadinessCheck implements OnApplicationShutdown {
  readonly name = 'object-storage';

  constructor(@Inject(S3) private readonly s3: S3Client) {
    super();
  }

  async check(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET_OPEN_DATA }));
  }

  onApplicationShutdown(): void {
    this.s3.destroy();
  }
}

/**
 * Object storage for the open-data releases' dataset files (ADR-002), the `open-data` bucket.
 * The client connects lazily, so the module resolves without storage.
 */
@Global()
@Module({
  providers: [
    {
      provide: S3,
      useFactory: () =>
        s3Client({
          endpoint: config.S3_ENDPOINT,
          region: config.S3_REGION,
          accessKeyId: config.S3_ACCESS_KEY_ID,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY,
        }),
    },
    {
      provide: OpenDataFiles,
      inject: [S3],
      useFactory: (s3: S3Client) => new S3OpenDataFiles(s3, config.S3_BUCKET_OPEN_DATA),
    },
    OpenDataStorageReadinessCheck,
  ],
  exports: [OpenDataFiles, OpenDataStorageReadinessCheck],
})
export class OpenDataStorageModule {}
