import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { config } from '../../src/config.js';
import {
  OpenDataFileMissing,
  OpenDataStorageUnavailable,
} from '../../src/open-data/open-data-files.js';
import { S3OpenDataFiles, s3Client } from '../../src/open-data/s3-open-data-files.js';

/**
 * The S3 adapter of the open-data bucket against SeaweedFS (`TEST_S3_ENDPOINT`, the `open-data`
 * bucket from infra/compose/seaweedfs/create-buckets.sh): a file written reads back byte for
 * byte, a missing key is `OpenDataFileMissing`, and storage that refuses the credentials is
 * `OpenDataStorageUnavailable`.
 */
describe('S3 open-data files', () => {
  const s3 = s3Client({
    endpoint: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:8333',
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  });
  const files = new S3OpenDataFiles(s3, config.S3_BUCKET_OPEN_DATA);
  const prefix = `test/${randomUUID()}`;

  afterAll(() => {
    s3.destroy();
  });

  it('writes a file and reads it back', async () => {
    const body = Buffer.from('commission,received\r\npsc,3\r\n', 'utf8');
    await files.put({
      key: `${prefix}/access-requests.csv`,
      body,
      contentType: 'text/csv; charset=utf-8',
    });

    expect(Buffer.from(await files.get(`${prefix}/access-requests.csv`))).toEqual(body);
  });

  it('reports a missing file', async () => {
    await expect(files.get(`${prefix}/none.json`)).rejects.toBeInstanceOf(OpenDataFileMissing);
  });

  it('reports storage that refuses the request', async () => {
    const refused = s3Client({
      endpoint: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:8333',
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: 'not-the-secret',
    });
    const elsewhere = new S3OpenDataFiles(refused, config.S3_BUCKET_OPEN_DATA);
    try {
      await expect(
        elsewhere.put({
          key: `${prefix}/x.json`,
          body: Buffer.from('{}'),
          contentType: 'application/json',
        }),
      ).rejects.toBeInstanceOf(OpenDataStorageUnavailable);
      await expect(elsewhere.get(`${prefix}/x.json`)).rejects.toBeInstanceOf(
        OpenDataStorageUnavailable,
      );
    } finally {
      refused.destroy();
    }
  });
});
