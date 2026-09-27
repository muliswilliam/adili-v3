import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JobActivities } from '../../src/jobs/job-activities.js';
import type { JobExecutor } from '../../src/jobs/job-executor.js';
import type { JobReason } from '../../src/jobs/job-states.js';
import { aiJob } from '../../src/jobs/workflows.js';
import { ProviderError, type ProviderErrorKind } from '../../src/providers/port.js';

const workflowsPath = fileURLToPath(new URL('../../src/jobs/workflows.ts', import.meta.url));
const JOB_ID = '0199a8f0-5555-7000-8000-000000000005';

/** An executor whose attempts fail with the given errors, in order, then succeed. */
function scriptedExecutor(failures: Error[]) {
  const calls = { execute: 0, failed: [] as JobReason[] };
  const executor = {
    execute: () => {
      calls.execute += 1;
      const failure = failures.shift();
      return failure === undefined ? Promise.resolve() : Promise.reject(failure);
    },
    fail: (_jobId: string, reason: JobReason) => {
      calls.failed.push(reason);
      return Promise.resolve();
    },
  };
  return { calls, activities: new JobActivities(executor as unknown as JobExecutor) };
}

const providerError = (kind: ProviderErrorKind) =>
  new ProviderError(kind, 'anthropic', `anthropic: ${kind}`);

/** The `aiJob` workflow with the real activities over a scripted executor, timers skipped. */
describe('aiJob workflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  });

  afterAll(async () => {
    await env.teardown();
  });

  async function run(failures: Error[]) {
    const { calls, activities } = scriptedExecutor(failures);
    await env.execute(aiJob, {
      workflowsPath,
      activities: {
        executeJob: (jobId: string) => activities.executeJob(jobId),
        failJob: (jobId: string, reason: JobReason) => activities.failJob(jobId, reason),
      },
      args: [{ jobId: JOB_ID, attemptTimeoutMs: 90_000 }],
    });
    return calls;
  }

  it('retries transient provider errors until an attempt succeeds', async () => {
    const calls = await run([providerError('unavailable'), providerError('rate-limited')]);

    expect(calls).toEqual({ execute: 3, failed: [] });
  });

  it('fails the job with reason provider once the retries are spent', async () => {
    const calls = await run(Array.from({ length: 10 }, () => providerError('unavailable')));

    expect(calls).toEqual({ execute: 4, failed: ['provider'] });
  });

  it('fails the job with reason timeout when the provider keeps timing out', async () => {
    const calls = await run(Array.from({ length: 10 }, () => providerError('timeout')));

    expect(calls).toEqual({ execute: 4, failed: ['timeout'] });
  });

  it('does not retry a provider error that cannot succeed', async () => {
    const calls = await run([providerError('bad-request')]);

    expect(calls).toEqual({ execute: 1, failed: ['provider'] });
  });

  it('retries other errors, such as a database outage', async () => {
    const calls = await run([new Error('connection terminated')]);

    expect(calls).toEqual({ execute: 2, failed: [] });
  });
});
