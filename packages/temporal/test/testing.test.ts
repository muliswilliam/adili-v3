import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { WorkflowTestEnvironment } from '../src/testing.js';
import { awaitNudge, countNudges, greet, lastNudge, nudge } from './fixtures/workflows.js';

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

  // Each skip ends as the workflow's hourly timer falls due. Sent then, a signal's workflow task
  // cancels a timer that fires while the task is with the worker; the time-skipping server
  // refuses that completion ("invalid history builder state", temporalio/sdk-java#3088) and the
  // run is stranded: without the settling in `skipTime`, the result never comes.
  it('signals sent as a skip ends on a due timer reach the workflow', async () => {
    const signals = 40;
    const result = await env.run(
      countNudges,
      { workflowsPath, activities: {}, args: [signals] },
      async (handle) => {
        for (let sent = 0; sent < signals; sent++) {
          await env.skipTime({ ms: 60 * 60 * 1000 });
          await handle.signal(nudge, 'wake up');
        }
        return handle.result();
      },
    );

    expect(result).toBe(signals);
  });
});
