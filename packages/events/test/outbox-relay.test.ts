import type { ClientProxy } from '@nestjs/microservices';
import type { Database } from '@adili/data-access';
import { from, NEVER, type Observable, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OutboxRelay, RELAY_PUBLISH_TIMEOUT_MS } from '../src/events.module.js';

interface Row {
  id: string;
  eventType: string;
  envelope: object;
}

/**
 * A database whose transactions claim `rows` once and record each row update; `open` counts the
 * transactions not yet ended.
 */
function fakeDatabase(rows: Row[]) {
  const updates: Record<string, unknown>[] = [];
  let claimed = false;
  const state = { open: 0 };
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              for: () => {
                const batch = claimed ? [] : rows;
                claimed = true;
                return Promise.resolve(batch);
              },
            }),
          }),
          // The depth count is `await select().from().where()`, so this query is thenable too.
          then: (onFulfilled: (value: { depth: number }[]) => unknown) =>
            Promise.resolve([{ depth: rows.length }]).then(onFulfilled),
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
  const db = {
    transaction: async <T>(work: (t: typeof tx) => Promise<T>): Promise<T> => {
      state.open += 1;
      try {
        return await work(tx);
      } finally {
        state.open -= 1;
      }
    },
  };
  return { db: db as unknown as Database, updates, state };
}

function client(emit: (eventType: string) => Observable<unknown>): ClientProxy {
  return { emit } as unknown as ClientProxy;
}

const row = (id: string): Row => ({ id, eventType: 'test.happened.v1', envelope: { id } });

describe('OutboxRelay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts a publish the broker never confirms as failed, so shutdown ends its transaction', async () => {
    const { db, updates, state } = fakeDatabase([row('a')]);
    const relay = new OutboxRelay(
      db,
      client(() => NEVER),
      {
        service: 'test',
        rabbitmqUrl: 'amqp://localhost',
      },
    );

    relay.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.open).toBe(1);

    let closed = false;
    const shutdown = relay.beforeApplicationShutdown().then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(RELAY_PUBLISH_TIMEOUT_MS - 1);
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await shutdown;

    expect(state.open).toBe(0);
    expect(updates).toEqual([
      expect.objectContaining({ lastError: expect.stringContaining('Timeout') as unknown }),
    ]);
  });

  it('stops before the next row once shutting down, leaving the rest unpublished', async () => {
    const { db, updates, state } = fakeDatabase([row('a'), row('b')]);
    const emitted: string[] = [];
    let release: () => void = () => undefined;
    const confirmed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const relay = new OutboxRelay(
      db,
      client((eventType) => {
        emitted.push(eventType);
        return emitted.length === 1 ? from(confirmed) : of(undefined);
      }),
      { service: 'test', rabbitmqUrl: 'amqp://localhost' },
    );

    relay.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    const shutdown = relay.beforeApplicationShutdown();
    release();
    await shutdown;

    expect(emitted).toHaveLength(1);
    expect(updates).toEqual([{ publishedAt: expect.any(Date) as unknown }]);
    expect(state.open).toBe(0);
  });
});
