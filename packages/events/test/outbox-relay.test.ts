import 'reflect-metadata';

import type { ClientProxy } from '@nestjs/microservices';
import type { Database } from '@adili/data-access';
import { Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OutboxRelay } from '../src/events.module.js';

/** A query builder that resolves to `result` whichever chain of calls ends in `await`. */
function query(result: unknown): unknown {
  const builder: object = new Proxy(() => undefined, {
    get: (_, key) =>
      key === 'then'
        ? (resolve: (value: unknown) => void) => {
            resolve(result);
          }
        : () => builder,
  });
  return builder;
}

/** A database whose relay transaction claims `rows`, and reports when the transaction ends. */
function fakeDatabase(rows: { id: string }[]) {
  let ended!: () => void;
  const transactionEnded = new Promise<void>((resolve) => (ended = resolve));
  const tx = { select: () => query(rows), update: () => query(undefined) };
  const db = {
    transaction: async (work: (t: typeof tx) => Promise<unknown>) => {
      try {
        return await work(tx);
      } finally {
        ended();
      }
    },
  };
  return { db: db as unknown as Database, transactionEnded };
}

/** A broker client whose publishes each wait for `release`. */
function fakeClient() {
  const pending: (() => void)[] = [];
  const emit = vi.fn(
    () =>
      new Observable<void>((subscriber) => {
        pending.push(() => {
          subscriber.complete();
        });
      }),
  );
  return {
    client: { emit } as unknown as ClientProxy,
    emit,
    release: () => pending.shift()?.(),
  };
}

const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }].map((row) => ({
  ...row,
  eventType: 'test.v1',
  envelope: {},
}));

describe('OutboxRelay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the publish in flight, then stops the batch before the next row', async () => {
    vi.useFakeTimers();
    const { db, transactionEnded } = fakeDatabase(rows);
    const { client, emit, release } = fakeClient();
    const relay = new OutboxRelay(db, client);

    relay.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(emit).toHaveBeenCalledTimes(1);

    let shutDown = false;
    const shutdown = relay.beforeApplicationShutdown().then(() => (shutDown = true));
    await vi.advanceTimersByTimeAsync(0);
    // The broker client and the pool close after this hook: it must outlast the open batch.
    expect(shutDown).toBe(false);

    release();
    await shutdown;
    await transactionEnded;
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('gives up on a publish that never settles, ending the batch and its transaction', async () => {
    vi.useFakeTimers();
    const { db, transactionEnded } = fakeDatabase(rows);
    const { client, emit } = fakeClient();
    const relay = new OutboxRelay(db, client);

    relay.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(10_000);
    await transactionEnded;
    expect(emit).toHaveBeenCalledTimes(1);
    await relay.beforeApplicationShutdown();
  });
});
