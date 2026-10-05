import { HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/** Where the anchors are archived: the `audit-archive` bucket (ADR-002, ADR-008). */
export abstract class AnchorArchive {
  abstract put(key: string, body: string): Promise<void>;
  abstract check(): Promise<void>;
}

export class S3AnchorArchive extends AnchorArchive {
  private readonly s3: S3Client;

  constructor(
    options: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string },
    private readonly bucket: string,
  ) {
    super();
    this.s3 = new S3Client({
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

  async put(key: string, body: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/json',
      }),
    );
  }

  async check(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  destroy(): void {
    this.s3.destroy();
  }
}
