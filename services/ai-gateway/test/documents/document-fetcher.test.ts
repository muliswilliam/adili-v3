import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DocumentFetcher } from '../../src/documents/document-fetcher.js';
import { TINY_PNG } from '../support/documents.js';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Fetching the document an extract-document job reads (spec 05b): from the documents store only,
 * no bigger than a reading takes, and exactly the file the request names.
 */
describe('DocumentFetcher', () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url?.startsWith('/clean/scan.png')) {
        response.writeHead(200, { 'content-type': 'image/png' }).end(TINY_PNG);
      } else if (request.url === '/clean/moved') {
        response.writeHead(302, { location: '/clean/scan.png' }).end();
      } else if (request.url === '/clean/big') {
        response.writeHead(200).end(Buffer.alloc(4096));
      } else {
        response.writeHead(403).end('<Error>Request has expired</Error>');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(
    () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  );

  const fetcher = () =>
    new DocumentFetcher({ allowedOrigins: [origin], maxBytes: 1024, timeoutMs: 5_000 });
  const ref = (path: string, hash = sha256(TINY_PNG)) => ({
    downloadUrl: `${origin}${path}`,
    contentType: 'image/png' as const,
    sha256: hash,
  });

  it('returns the file the request names', async () => {
    const bytes = await fetcher().fetch(ref('/clean/scan.png?X-Amz-Signature=abc'));

    expect(Buffer.from(bytes)).toEqual(Buffer.from(TINY_PNG));
  });

  it('refuses a file whose SHA-256 is not the one named', async () => {
    await expect(fetcher().fetch(ref('/clean/scan.png', 'b'.repeat(64)))).rejects.toMatchObject({
      kind: 'mismatch',
    });
  });

  it('fails as unavailable when the link has expired', async () => {
    await expect(fetcher().fetch(ref('/clean/expired'))).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('fetches nothing from an origin that is not the documents store', async () => {
    const other = new DocumentFetcher({
      allowedOrigins: ['http://storage.internal:8333'],
      maxBytes: 1024,
      timeoutMs: 5_000,
    });

    await expect(other.fetch(ref('/clean/scan.png'))).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('follows no redirect, which could lead anywhere', async () => {
    await expect(fetcher().fetch(ref('/clean/moved'))).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('stops reading a file bigger than a reading takes', async () => {
    await expect(fetcher().fetch(ref('/clean/big'))).rejects.toMatchObject({ kind: 'too-large' });
  });
});
