import 'reflect-metadata';

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
    expect(Date.now() - started).toBeLessThan(2_000);
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
});
