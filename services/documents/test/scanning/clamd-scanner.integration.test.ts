import { describe, expect, it } from 'vitest';

import { ClamdScanner } from '../../src/scanning/malware-scanner.js';
import { EICAR, fixture } from '../support/files.js';

/** The INSTREAM client against the real clamd (compose locally, a service container in CI). */
const scanner = new ClamdScanner(
  process.env.TEST_CLAMAV_HOST ?? 'localhost',
  Number(process.env.TEST_CLAMAV_PORT ?? 3310),
);

async function* chunks(...parts: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const part of parts) {
    await Promise.resolve();
    yield part;
  }
}

const noTimeout = () => new AbortController().signal;

describe('ClamdScanner', () => {
  it('reports a clean file', async () => {
    expect(await scanner.scan(chunks(fixture('roster.csv')), noTimeout())).toEqual({
      infected: false,
    });
  });

  it('reports the EICAR test file with its signature', async () => {
    expect(await scanner.scan(chunks(EICAR), noTimeout())).toEqual({
      infected: true,
      signature: expect.stringMatching(/eicar/i) as string,
    });
  });

  it('streams a file larger than one frame', async () => {
    const big = Buffer.alloc(1024 * 1024 + 17, 'a,b,c\n');
    expect(
      await scanner.scan(chunks(big.subarray(0, 300_000), big.subarray(300_000)), noTimeout()),
    ).toEqual({ infected: false });
  });

  it('rejects when the signal aborts mid-stream', async () => {
    const controller = new AbortController();
    async function* stalled(): AsyncIterable<Uint8Array> {
      yield Buffer.from('a,b\n');
      controller.abort(new Error('budget spent'));
      await new Promise(() => undefined);
    }
    await expect(scanner.scan(stalled(), controller.signal)).rejects.toThrow();
  });

  it('rejects when clamd is unreachable', async () => {
    const nowhere = new ClamdScanner('127.0.0.1', 1);
    await expect(nowhere.scan(chunks(Buffer.from('a')), noTimeout())).rejects.toThrow();
  });
});
