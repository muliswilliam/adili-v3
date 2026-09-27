import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { WorkflowTestEnvironment } from '../src/testing.js';
import { greet } from './fixtures/workflows.js';

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
});
