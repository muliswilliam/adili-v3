import 'reflect-metadata';

import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { TemporalWorkerModule, TemporalWorkerReadinessCheck } from '../src/index.js';
import { GREETING_PREFIX, GreetingActivities } from './fixtures/greeting-activities.js';

@Injectable()
class DuplicateActivities {
  composeGreeting(): Promise<string> {
    return Promise.resolve('again');
  }
}

class GreetingBase {
  composeGreeting(): Promise<string> {
    return Promise.resolve('inherited');
  }
}

@Injectable()
class InheritedActivities extends GreetingBase {}

@Injectable()
class AccessorActivities {
  private readonly state = { count: 0 };

  /** Reading this on the prototype, where `state` is undefined, throws. */
  get count(): number {
    return this.state.count;
  }

  countCalls(): Promise<number> {
    return Promise.resolve(++this.state.count);
  }
}

const options = {
  // Nothing listens here, so the worker never connects.
  address: '127.0.0.1:1',
  namespace: 'adili',
  taskQueue: 'unit-test',
  workflowsPath: 'unused',
};

describe('TemporalWorkerModule', () => {
  it('starts without Temporal, reports not ready and shuts down promptly', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TemporalWorkerModule.forRoot({
          ...options,
          activities: [GreetingActivities],
        }),
      ],
    })
      .useMocker((token) => (token === GREETING_PREFIX ? 'Habari' : undefined))
      .compile();
    await moduleRef.init();

    await expect(moduleRef.get(TemporalWorkerReadinessCheck).check()).rejects.toThrow(
      /not polling/,
    );
    const started = Date.now();
    await moduleRef.close();
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('shuts down promptly while still connecting to an unresponsive server', async () => {
    // Accepts TCP connections and never answers, so the gRPC handshake hangs.
    const sockets = new Set<Socket>();
    const silent: Server = createServer((socket) => {
      sockets.add(socket);
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const { port } = silent.address() as AddressInfo;
    try {
      const moduleRef = await Test.createTestingModule({
        imports: [
          TemporalWorkerModule.forRoot({
            ...options,
            address: `127.0.0.1:${port}`,
            activities: [GreetingActivities],
            drainTimeoutMs: 60_000,
          }),
        ],
      })
        .useMocker((token) => (token === GREETING_PREFIX ? 'Habari' : undefined))
        .compile();
      await moduleRef.init();
      // Let the connection attempt start.
      await new Promise((resolve) => setTimeout(resolve, 200));

      const started = Date.now();
      await moduleRef.close();
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => silent.close(resolve));
    }
  });

  it('refuses two providers defining the same activity name', async () => {
    const compiling = Test.createTestingModule({
      imports: [
        TemporalWorkerModule.forRoot({
          ...options,
          activities: [GreetingActivities, DuplicateActivities],
        }),
      ],
    })
      .useMocker((token) => (token === GREETING_PREFIX ? 'Habari' : undefined))
      .compile();

    await expect(compiling).rejects.toThrow(/"composeGreeting" is defined by more than one/);
  });

  it('registers methods inherited from a base class', async () => {
    const compiling = Test.createTestingModule({
      imports: [
        TemporalWorkerModule.forRoot({
          ...options,
          activities: [GreetingActivities, InheritedActivities],
        }),
      ],
    })
      .useMocker((token) => (token === GREETING_PREFIX ? 'Habari' : undefined))
      .compile();

    await expect(compiling).rejects.toThrow(/"composeGreeting" is defined by more than one/);
  });

  it('skips accessors on activity providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TemporalWorkerModule.forRoot({ ...options, activities: [AccessorActivities] })],
    }).compile();

    expect(moduleRef.get(AccessorActivities).count).toBe(0);
    await moduleRef.close();
  });
});
