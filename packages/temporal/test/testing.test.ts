import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { WorkflowTestEnvironment } from '../src/testing.js';
import { greet } from './fixtures/workflows.js';

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
  });

  it('reuses the workflow bundle, so later runs take milliseconds', async () => {
    const started = Date.now();

    const result = await env.execute(greet, {
      workflowsPath,
      activities: { composeGreeting: () => Promise.resolve('ok') },
      args: ['Baraka'],
    });

    expect(result).toBe('ok');
    // The workflow sleeps for a day; time skipping and the cached bundle make it near-instant.
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
