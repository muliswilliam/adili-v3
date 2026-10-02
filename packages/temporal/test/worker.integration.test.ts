import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Client } from '@temporalio/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  TEMPORAL_CLIENT,
  TemporalModule,
  TemporalWorkerModule,
  TemporalWorkerReadinessCheck,
  WorkflowBundler,
} from '../src/index.js';
import {
  prebuiltWorkflowBundler,
  type WorkflowBundles,
  workflowBundlesSetup,
} from '../src/testing.js';
import { GREETING_PREFIX, GreetingActivities } from './fixtures/greeting-activities.js';
import { greetNow } from './fixtures/workflows.js';

/**
 * Runs the worker module inside a Nest app against compose Temporal (`pnpm infra:up`):
 * workflow + Nest-provided activity round trip, readiness, and shutdown drain.
 */
const ADDRESS = requireEnv('TEST_TEMPORAL_ADDRESS');
const NAMESPACE = requireEnv('TEST_TEMPORAL_NAMESPACE');
const workflowsPath = fileURLToPath(new URL('fixtures/workflows.ts', import.meta.url));

@Module({
  providers: [{ provide: GREETING_PREFIX, useValue: 'Habari' }],
  exports: [GREETING_PREFIX],
})
class PrefixModule {}

async function createApp(options: {
  taskQueue: string;
  drainTimeoutMs?: number;
  bundler?: WorkflowBundler;
}) {
  const builder = Test.createTestingModule({
    imports: [
      TemporalModule.forRoot({ address: ADDRESS, namespace: NAMESPACE }),
      TemporalWorkerModule.forRoot({
        address: ADDRESS,
        namespace: NAMESPACE,
        taskQueue: options.taskQueue,
        workflowsPath,
        imports: [PrefixModule],
        activities: [GreetingActivities],
        drainTimeoutMs: options.drainTimeoutMs,
      }),
    ],
  });
  return (
    options.bundler ? builder.overrideProvider(WorkflowBundler).useValue(options.bundler) : builder
  ).compile();
}

async function waitUntil(condition: () => boolean | Promise<boolean>, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function isUp(readiness: TemporalWorkerReadinessCheck): Promise<boolean> {
  return readiness.check().then(
    () => true,
    () => false,
  );
}

describe('TemporalWorkerModule against compose Temporal', () => {
  let app: TestingModule | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('runs a workflow whose activity is a Nest provider', async () => {
    const taskQueue = `worker-test-${randomUUID()}`;
    app = await createApp({ taskQueue });
    await app.init();
    const client = app.get<Client>(TEMPORAL_CLIENT);

    const result = await client.workflow.execute(greetNow, {
      taskQueue,
      workflowId: randomUUID(),
      args: ['Amina'],
    });

    expect(result).toBe('Habari, Amina');
  });

  it('runs workflows under Node watch mode, as dev scripts do', async () => {
    // `node --watch` sets this for the process it runs; on recent Node (nodejs/node#62368) each
    // workflow thread then posts its module loads to the thread's `message` listeners.
    const previous = process.env.WATCH_REPORT_DEPENDENCIES;
    process.env.WATCH_REPORT_DEPENDENCIES = '1';
    try {
      const taskQueue = `worker-test-${randomUUID()}`;
      app = await createApp({ taskQueue });
      await app.init();
      const client = app.get<Client>(TEMPORAL_CLIENT);

      const result = await client.workflow.execute(greetNow, {
        taskQueue,
        workflowId: randomUUID(),
        args: ['Wanjiku'],
      });

      expect(result).toBe('Habari, Wanjiku');
    } finally {
      if (previous === undefined) delete process.env.WATCH_REPORT_DEPENDENCIES;
      else process.env.WATCH_REPORT_DEPENDENCIES = previous;
    }
  });

  describe('with bundles built once for the run', () => {
    let bundles: WorkflowBundles | undefined;

    beforeAll(async () => {
      // As Vitest runs it from a config's globalSetup.
      const setup = workflowBundlesSetup([workflowsPath]);
      await setup({
        provide: (_key: 'workflowBundles', value: WorkflowBundles) => {
          bundles = value;
        },
      } as unknown as Parameters<typeof setup>[0]);
    });

    it('runs workflows from the prebuilt bundle', async () => {
      const taskQueue = `worker-test-${randomUUID()}`;
      app = await createApp({ taskQueue, bundler: prebuiltWorkflowBundler(bundles) });
      await app.init();
      const client = app.get<Client>(TEMPORAL_CLIENT);

      const result = await client.workflow.execute(greetNow, {
        taskQueue,
        workflowId: randomUUID(),
        args: ['Njeri'],
      });

      expect(result).toBe('Habari, Njeri');
    });

    it('reports a workflows module the setup did not bundle as the reason it is down', async () => {
      app = await createApp({
        taskQueue: `worker-test-${randomUUID()}`,
        bundler: prebuiltWorkflowBundler({}),
      });
      const readiness = app.get(TemporalWorkerReadinessCheck);
      await app.init();

      const reason = async () => {
        const error = await readiness.check().then(
          () => undefined,
          (failure: unknown) => failure,
        );
        return error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
      };
      await waitUntil(async () => (await reason()) !== undefined);

      expect((await reason())?.message).toContain(
        `No prebuilt workflow bundle for ${workflowsPath}`,
      );
    });
  });

  it('reports down until the worker is polling, then up', async () => {
    app = await createApp({ taskQueue: `worker-test-${randomUUID()}` });
    const readiness = app.get(TemporalWorkerReadinessCheck);

    await expect(readiness.check()).rejects.toThrow(/not polling/);
    await app.init();
    await waitUntil(() => isUp(readiness));
  });

  it('shuts down cleanly while the worker is still being created', async () => {
    app = await createApp({ taskQueue: `worker-test-${randomUUID()}` });
    const errors: unknown[] = [];
    app.useLogger({
      log: () => undefined,
      warn: () => undefined,
      error: (message: unknown) => errors.push(message),
    });
    await app.init();
    // Connected by now, and still bundling the workflows.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const closing = app.close();
    app = undefined;

    await closing;

    expect(errors).toEqual([]);
  });

  it('reports down and waits for in-flight activities while shutting down', async () => {
    const taskQueue = `worker-test-${randomUUID()}`;
    app = await createApp({ taskQueue, drainTimeoutMs: 10_000 });
    await app.init();
    const readiness = app.get(TemporalWorkerReadinessCheck);
    const activities = app.get(GreetingActivities);
    activities.delayMs = 1_500;
    const client = app.get<Client>(TEMPORAL_CLIENT);

    await client.workflow.start(greetNow, {
      taskQueue,
      workflowId: randomUUID(),
      args: ['Baraka'],
      // The worker stops before the workflow finishes; let Temporal close it.
      workflowExecutionTimeout: '1 minute',
    });
    await waitUntil(() => activities.started === 1);
    const closing = app.close();
    app = undefined;
    await waitUntil(async () => !(await isUp(readiness)));
    expect(activities.completed).toBe(0);
    await closing;

    expect(activities.completed).toBe(1);
  });

  it('stops waiting for in-flight activities after the drain time', async () => {
    const taskQueue = `worker-test-${randomUUID()}`;
    app = await createApp({ taskQueue, drainTimeoutMs: 500 });
    // The SDK logs the activity it gives up on as a worker failure: expected here.
    app.useLogger(false);
    await app.init();
    const activities = app.get(GreetingActivities);
    activities.delayMs = 60_000;
    const client = app.get<Client>(TEMPORAL_CLIENT);

    await client.workflow.start(greetNow, {
      taskQueue,
      workflowId: randomUUID(),
      args: ['Chebet'],
      workflowExecutionTimeout: '1 minute',
    });
    await waitUntil(() => activities.started === 1);
    const started = Date.now();
    await app.close();
    app = undefined;

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(activities.completed).toBe(0);
  });
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
