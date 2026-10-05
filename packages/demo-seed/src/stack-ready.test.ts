import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { waitForServicesReady } from './stack-ready.js';

const servers: Server[] = [];

/** A service whose `/health/ready` answers with what `answer` returns for the nth request. */
async function service(answer: (request: number) => { status: number; body?: unknown }) {
  let requests = 0;
  const server = createServer((request, response) => {
    const { status, body } = answer(++requests);
    response.writeHead(request.url === '/health/ready' ? status : 404, {
      'content-type': 'application/json',
    });
    response.end(JSON.stringify(body ?? {}));
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

/** A URL nothing listens on: a service the freeze took down. */
async function deadService() {
  const url = await service(() => ({ status: 200 }));
  const server = servers.pop();
  await new Promise((resolve) => server?.close(resolve));
  return url;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

const fast = { intervalMs: 10, timeoutMs: 2_000, refusedTimeoutMs: 200 };

describe('waitForServicesReady', () => {
  it('waits for a service recovering after the freeze', async () => {
    const recovering = await service((n) =>
      n < 3
        ? { status: 503, body: { status: 'down', checks: { postgres: { status: 'down' } } } }
        : { status: 200, body: { status: 'up' } },
    );
    const ready = await service(() => ({ status: 200 }));
    const lines: string[] = [];

    await waitForServicesReady(
      [
        { name: 'review', url: recovering },
        { name: 'directory', url: ready },
      ],
      { ...fast, log: (line) => lines.push(line) },
    );

    expect(lines[0]).toBe('Waiting for services to be ready: review');
    expect(lines.at(-1)).toMatch(/^All services ready after/);
  });

  it('fails naming a service that is not running, without waiting out the deadline', async () => {
    const started = Date.now();
    const error = await waitForServicesReady(
      [
        { name: 'review', url: await deadService() },
        { name: 'directory', url: await service(() => ({ status: 200 })) },
      ],
      { ...fast, timeoutMs: 60_000 },
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Not running: review\./);
    expect((error as Error).message).toMatch(/review \(.+\): not running \(connection refused\)/);
    expect((error as Error).message).not.toMatch(/directory/);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('fails after the deadline with the checks a service still reports down', async () => {
    const stuck = await service(() => ({
      status: 503,
      body: {
        status: 'down',
        checks: {
          postgres: { status: 'up' },
          rabbitmq: { status: 'down', error: 'timed out after 2000ms' },
        },
      },
    }));

    await expect(
      waitForServicesReady([{ name: 'audit', url: stuck }], { ...fast, timeoutMs: 100 }),
    ).rejects.toThrow(
      /not ready after 0s:\n {2}audit \(.+\): not ready \(rabbitmq: timed out after 2000ms\)$/,
    );
  });
});
