import 'reflect-metadata';

import { once } from 'node:events';
import net from 'node:net';

import { Global, Logger, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DATABASE } from '@adili/data-access';
import { beforeAll, describe, expect, it } from 'vitest';

import { EventsModule, RabbitMqReadinessCheck } from '../src/events.module.js';

const CONNECT_TIMEOUT_MS = 300;

/**
 * A peer that accepts and answers the AMQP protocol header with itself, then nothing: what a
 * client gets when its socket connects to itself (Linux does, for a connect to an unused local
 * port in its ephemeral range).
 */
let broker: net.Server;
let url: string;

beforeAll(async () => {
  Logger.overrideLogger(false);
  broker = net.createServer((socket) => {
    socket.on('data', (data) => socket.write(data));
    socket.on('error', () => undefined);
  });
  broker.listen(0, '127.0.0.1');
  await once(broker, 'listening');
  const { port } = broker.address() as net.AddressInfo;
  url = `amqp://adili:adili_dev@127.0.0.1:${port}`;
  return () => {
    broker.close();
    Logger.overrideLogger(true);
  };
});

/** A database whose relay transactions always claim one unpublished row, recording its updates. */
function fakeDatabase() {
  const updates: Record<string, unknown>[] = [];
  const row = { id: 'row-1', eventType: 'test.event.v1', envelope: { id: 'row-1' } };
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => ({ for: () => Promise.resolve([row]) }) }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values);
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db: { transaction: <T>(work: (t: typeof tx) => Promise<T>) => work(tx) }, updates };
}

describe('a broker that accepts and never answers', () => {
  const options = { service: 'test', rabbitmqUrl: '', connectTimeoutMs: CONNECT_TIMEOUT_MS };

  it('lets the service start not ready, then fails the readiness check, within the bound', async () => {
    const check = new RabbitMqReadinessCheck({ ...options, rabbitmqUrl: url });
    const started = performance.now();

    await check.onApplicationBootstrap();
    await expect(check.check()).rejects.toThrow(/ETIMEDOUT/);

    expect(performance.now() - started).toBeLessThan(CONNECT_TIMEOUT_MS * 2 + 1_000);
  });

  it('fails the relay publish within the bound, and shuts down', async () => {
    const { db, updates } = fakeDatabase();
    @Global()
    @Module({ providers: [{ provide: DATABASE, useValue: db }], exports: [DATABASE] })
    class FakeDatabaseModule {}
    const moduleRef = await Test.createTestingModule({
      imports: [FakeDatabaseModule, EventsModule.forRoot({ ...options, rabbitmqUrl: url })],
    }).compile();
    await moduleRef.init();

    // Before the relay's publish timeout (10 s): the connect itself gave up.
    await expect
      .poll(() => updates.some((update) => 'attempts' in update), { timeout: 3_000 })
      .toBe(true);
    const closing = performance.now();
    await moduleRef.close();
    expect(performance.now() - closing).toBeLessThan(2_000);
  });
});
