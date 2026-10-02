import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpRosterUploads } from '../../src/roster/import/http-roster-uploads.js';
import {
  DocumentsUnavailable,
  UploadNotClean,
  UploadNotFound,
} from '../../src/roster/import/roster-uploads.js';
import { componentSchema, contractErrors } from '../support/contract.js';

/**
 * The documents adapter against a stub documents service and object store on a local port:
 * the requests it makes and how it reads the answers.
 */
const UPLOAD_ID = '0199a000-0000-7000-8000-00000000abcd';
const CSV = 'text/csv';
const REF = { tenant: 'psc', uploadId: UPLOAD_ID };
const FILE = 'personnel_file_number,full_name,national_id\nPSC/1,Jane Doe,12345678\n';

type Handler = (request: IncomingMessage) => {
  status: number;
  body?: unknown;
  raw?: string;
  /** Writes the response itself, e.g. slowly. */
  stream?: (response: ServerResponse) => void;
};

let server: Server;
let baseUrl: string;
let handler: Handler;
let requests: IncomingMessage[];

beforeAll(async () => {
  server = createServer((request, response) => {
    requests.push(request);
    const answer = handler(request);
    response.statusCode = answer.status;
    if (answer.stream) answer.stream(response);
    else if (answer.raw !== undefined) response.end(answer.raw);
    else response.end(answer.body === undefined ? '' : JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  requests = [];
  handler = documents();
});

/** Documents answering the download request with `download`, and storage serving FILE. */
function documents(
  download: Partial<{ status: number; body: unknown; raw: string }> = {},
): Handler {
  return (request) => {
    if (request.url?.startsWith('/files/')) return { status: 200, raw: FILE };
    return {
      status: download.status ?? 200,
      raw: download.raw,
      body: download.body ?? uploadDownload(),
    };
  };
}

/** Documents' answer to the download request for UPLOAD_ID, as its contract describes it. */
const uploadDownload = (): Record<string, unknown> => ({
  id: UPLOAD_ID,
  purpose: 'roster-import',
  state: 'clean',
  downloadUrl: `${baseUrl}/files/${UPLOAD_ID}`,
  expiresAt: '2026-09-28T10:05:00.000Z',
  sha256: 'ab'.repeat(32),
  size: FILE.length,
  fileName: 'roster.csv',
  detectedType: CSV,
});

const UPLOAD_DOWNLOAD = componentSchema('UploadDownload');

function adapter(
  tokens = ['token-1', 'token-2'],
  timeouts: { headersTimeoutMs?: number; idleTimeoutMs?: number } = {},
) {
  let issued = 0;
  let invalidated = 0;
  const uploads = new HttpRosterUploads({
    ...timeouts,
    documentsUrl: `${baseUrl}/`,
    tokens: {
      token: () => Promise.resolve(tokens[Math.min(issued++, tokens.length - 1)] ?? ''),
      invalidate: () => {
        invalidated += 1;
      },
    },
  });
  return { uploads, invalidations: () => invalidated };
}

async function text(body: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

describe('HttpRosterUploads', () => {
  it('asks documents with its token acting for the tenant, then streams the file', async () => {
    const { uploads } = adapter();

    const upload = await uploads.open(REF);

    expect(upload).toMatchObject({
      id: UPLOAD_ID,
      fileName: 'roster.csv',
      format: 'csv',
      size: FILE.length,
    });
    expect(await text(upload.body)).toBe(FILE);
    const [download] = requests;
    expect(download?.url).toBe(`/internal/v1/uploads/${UPLOAD_ID}/download`);
    expect(download?.headers).toMatchObject({
      authorization: 'Bearer token-1',
      'x-acting-tenant': 'psc',
    });
  });

  it('describes an upload without downloading it', async () => {
    const { uploads } = adapter();

    expect(await uploads.describe(REF)).toMatchObject({ format: 'csv' });
    expect(requests).toHaveLength(1);
  });

  it('reads XLSX uploads as xlsx', async () => {
    handler = documents({
      body: {
        id: UPLOAD_ID,
        purpose: 'roster-import',
        downloadUrl: `${baseUrl}/files/x`,
        size: 10,
        fileName: null,
        detectedType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });

    expect(await adapter().uploads.describe(REF)).toMatchObject({ format: 'xlsx' });
  });

  it('retries once with a fresh token after a 401', async () => {
    let calls = 0;
    const ok = documents();
    handler = (request) => (++calls === 1 ? { status: 401 } : ok(request));
    const { uploads, invalidations } = adapter();

    await uploads.describe(REF);

    expect(invalidations()).toBe(1);
    expect(requests.map((request) => request.headers.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  it.each([
    ['404', { status: 404 }, UploadNotFound],
    ['409', { status: 409 }, UploadNotClean],
    ['500', { status: 500 }, DocumentsUnavailable],
    ['401 twice', { status: 401 }, DocumentsUnavailable],
    ['a body that is not JSON', { raw: '<html>Bad gateway</html>' }, DocumentsUnavailable],
    [
      'an upload for another purpose',
      {
        body: {
          id: UPLOAD_ID,
          purpose: 'declaration-attachment',
          downloadUrl: 'http://storage.test/files/x',
          size: 1,
          fileName: null,
          detectedType: CSV,
        },
      },
      UploadNotFound,
    ],
  ])('maps %s', async (_case, download, error) => {
    handler = documents(download);

    await expect(adapter().uploads.describe(REF)).rejects.toBeInstanceOf(error);
  });

  it("stubs documents' answer as its contract describes it", () => {
    expect(contractErrors(UPLOAD_DOWNLOAD, uploadDownload(), 'documents')).toEqual([]);
  });

  it.each([
    ['without a download URL', { downloadUrl: undefined }],
    ['with a size that is not a number', { size: '12' }],
    ['with an id that is not a UUID', { id: 'upload-1' }],
    ['with a file name that is not a string', { fileName: 12 }],
  ])('refuses an answer %s, which breaks the contract, as unavailable', async (_case, change) => {
    const body = { ...uploadDownload(), ...change };
    expect(contractErrors(UPLOAD_DOWNLOAD, body, 'documents')).not.toEqual([]);
    handler = documents({ body });

    await expect(adapter().uploads.describe(REF)).rejects.toBeInstanceOf(DocumentsUnavailable);
  });

  describe('reading a large file', () => {
    /** Storage sending `count` chunks, `gapMs` apart. */
    function slowStorage(count: number, gapMs: number): void {
      const ok = documents();
      handler = (request) =>
        request.url?.startsWith('/files/')
          ? {
              status: 200,
              stream: (response) => {
                response.flushHeaders();
                let sent = 0;
                const timer = setInterval(() => {
                  response.write(`row ${sent}\n`);
                  if (++sent === count) {
                    clearInterval(timer);
                    response.end();
                  }
                }, gapMs);
                response.on('close', () => {
                  clearInterval(timer);
                });
              },
            }
          : ok(request);
    }

    it('takes as long as the file needs while chunks keep coming', async () => {
      slowStorage(16, 25);
      // Each gap a tenth of the idle timeout, so a busy machine cannot stretch one past it.
      const { uploads } = adapter(undefined, { headersTimeoutMs: 250, idleTimeoutMs: 250 });

      const upload = await uploads.open(REF);

      // 16 chunks x 25 ms is well past both timeouts in total.
      expect(await text(upload.body)).toContain('row 15');
    });

    it('does not count time the reader spends on a chunk', async () => {
      // Fake timers and a hand-fed body: the reader's slow step is an exact clock advance, so
      // nothing here depends on how fast the machine is.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        let feed!: ReadableStreamDefaultController<Uint8Array>;
        const storage = new ReadableStream<Uint8Array>({
          start: (controller) => {
            feed = controller;
          },
        });
        const stubbed: typeof fetch = (input, init) => {
          // No sockets: undici's own timers would be frozen with the fake ones.
          if (!new Request(input).url.includes('/files/'))
            return Promise.resolve(Response.json(uploadDownload()));
          // Like a real download: aborting the request breaks the body.
          init?.signal?.addEventListener('abort', () => {
            feed.error(init.signal?.reason);
          });
          return Promise.resolve(new Response(storage));
        };
        const uploads = new HttpRosterUploads({
          documentsUrl: `${baseUrl}/`,
          tokens: { token: () => Promise.resolve('token'), invalidate: () => undefined },
          headersTimeoutMs: 100,
          idleTimeoutMs: 50,
          fetch: stubbed,
        });
        const encode = (row: string) => new TextEncoder().encode(row);

        const upload = await uploads.open(REF);
        const chunks = upload.body[Symbol.asyncIterator]();
        feed.enqueue(encode('row 0\n'));
        expect((await chunks.next()).value).toEqual(encode('row 0\n'));

        // The reader is busy with that chunk (staging writing a batch) for far longer than the
        // idle timeout, and asks for no chunk meanwhile.
        await vi.advanceTimersByTimeAsync(10_000);
        feed.enqueue(encode('row 1\n'));

        // The wait for the next chunk starts only now, so it is not timed out.
        expect((await chunks.next()).value).toEqual(encode('row 1\n'));
        feed.close();
        expect((await chunks.next()).done).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('gives up on storage that stalls part way', async () => {
      const ok = documents();
      handler = (request) =>
        request.url?.startsWith('/files/')
          ? { status: 200, stream: (response) => response.write('row 0\n') }
          : ok(request);
      const { uploads } = adapter(undefined, { headersTimeoutMs: 100, idleTimeoutMs: 50 });

      const upload = await uploads.open(REF);

      await expect(text(upload.body)).rejects.toBeInstanceOf(DocumentsUnavailable);
    });

    it('gives up on storage that never answers', async () => {
      const ok = documents();
      handler = (request) =>
        request.url?.startsWith('/files/') ? { status: 200, stream: () => undefined } : ok(request);
      const { uploads } = adapter(undefined, { headersTimeoutMs: 50 });

      await expect(uploads.open(REF)).rejects.toBeInstanceOf(DocumentsUnavailable);
    });
  });

  it('reports storage refusing the download as unavailable', async () => {
    const ok = documents();
    handler = (request) => (request.url?.startsWith('/files/') ? { status: 403 } : ok(request));

    await expect(adapter().uploads.open(REF)).rejects.toBeInstanceOf(DocumentsUnavailable);
  });

  it('reports an unreachable documents service as unavailable', async () => {
    const uploads = new HttpRosterUploads({
      documentsUrl: 'http://127.0.0.1:1',
      tokens: { token: () => Promise.resolve('token'), invalidate: () => undefined },
    });

    await expect(uploads.describe(REF)).rejects.toBeInstanceOf(DocumentsUnavailable);
  });
});
