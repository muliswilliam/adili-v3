import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { TemporalWorkerStatus } from '../src/temporal-worker.module.js';
import { untilActivitiesSettled, WorkflowTestEnvironment } from '../src/testing.js';
import { awaitNudge, greet, lastNudge, nudge } from './fixtures/workflows.js';

// One spy for every importer: the factory may run once per module graph.
const bundleWorkflowCode = vi.hoisted(() => vi.fn());
vi.mock('@temporalio/worker', async (importOriginal) => {
  const worker = await importOriginal<typeof import('@temporalio/worker')>();
  bundleWorkflowCode.mockImplementation(worker.bundleWorkflowCode);
  return { ...worker, bundleWorkflowCode };
});

const workflowsPath = fileURLToPath(new URL('fixtures/workflows.ts', import.meta.url));

describe('WorkflowTestEnvironment', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  });

  afterAll(async () => {
    await env.teardown();
  });

  it('runs a workflow against mocked activities, skipping timers', async () => {
    const composeGreeting = vi.fn((name: string) => Promise.resolve(`Hi, ${name}`));

    const result = await env.execute(greet, {
      workflowsPath,
      activities: { composeGreeting },
      args: ['Amina'],
    });

    expect(result).toBe('Hi, Amina');
    expect(composeGreeting).toHaveBeenCalledExactlyOnceWith('Amina');
    expect(bundleWorkflowCode).toHaveBeenCalledOnce();
  });

  it('reuses the workflow bundle across runs', async () => {
    const bundlesBefore = bundleWorkflowCode.mock.calls.length;

    const result = await env.execute(greet, {
      workflowsPath,
      activities: { composeGreeting: () => Promise.resolve('ok') },
      args: ['Baraka'],
    });

    expect(result).toBe('ok');
    // Bundling takes seconds; skipped timers and a cached bundle keep later runs near-instant.
    expect(bundleWorkflowCode.mock.calls.length).toBe(bundlesBefore);
  });

  it('drives a running workflow with signals, queries and skipped time', async () => {
    const before = await env.now();

    const result = await env.run(
      awaitNudge,
      { workflowsPath, activities: {}, args: [] },
      async (handle) => {
        await env.skipTime({ ms: 3 * 24 * 60 * 60 * 1000 });
        expect(await handle.query(lastNudge)).toBeNull();
        await handle.signal(nudge, 'wake up');
        return handle.result();
      },
    );

    expect(result).toBe('wake up');
    expect((await env.now()).getTime() - before.getTime()).toBeGreaterThanOrEqual(
      3 * 24 * 60 * 60 * 1000,
    );
  });
});

describe('untilActivitiesSettled', () => {
  /** A worker status whose in-flight count drops by one on each read after the first. */
  function draining(count: number): TemporalWorkerStatus {
    let left = count;
    return {
      get inFlightActivities() {
        const now = left;
        left = Math.max(0, left - 1);
        return now;
      },
    } as TemporalWorkerStatus;
  }

  it('resolves once the worker runs no activity', async () => {
    const status = draining(3);

    await untilActivitiesSettled(status);

    expect(status.inFlightActivities).toBe(0);
  });

  it('fails when an activity is still running at the deadline', async () => {
    const stuck = { inFlightActivities: 1 } as TemporalWorkerStatus;

    await expect(untilActivitiesSettled(stuck, 50)).rejects.toThrow(
      '1 activities still running after 50 ms',
    );
  });
});
