import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type DocumentReadingInput,
  READING_JOB_FINISHED_SIGNAL,
  READING_PULL_INTERVAL_MS,
  READING_TIMEOUT_MS,
  type ReadingOutcome,
  type ReadingSettle,
} from '../../src/suggestions/workflow/contract.js';
import { documentReading } from '../../src/suggestions/workflow/workflows.js';

/**
 * `DocumentReadingWorkflow` (spec 05b S6) against mocked activities in Temporal's time-skipping
 * test environment: it settles on the job's event or by pulling, waits on its starting
 * transaction first only, and fails what is still pending after the timeout.
 */
const workflowsPath = fileURLToPath(
  new URL('../../src/suggestions/workflow/workflows.ts', import.meta.url),
);

const input: DocumentReadingInput = {
  tenant: 'psc',
  declarationId: '0199a000-0000-7000-8000-00000000c001',
  personId: '0199a000-0000-7000-8000-00000000c002',
  subject: 'declarant-sub',
  jobId: '0199a000-0000-7000-8000-00000000c003',
  transactionId: '123456',
  timeoutMs: READING_TIMEOUT_MS,
};

let env: WorkflowTestEnvironment;

beforeAll(async () => {
  env = await WorkflowTestEnvironment.create();
}, 60_000);

afterAll(async () => {
  await env.teardown();
});

describe('documentReading', () => {
  it('pulls a job that never ends, then fails it at the timeout', async () => {
    const settled: ReadingSettle[] = [];
    const settleReading = vi.fn((ref: ReadingSettle): Promise<ReadingOutcome> => {
      settled.push(ref);
      return Promise.resolve('pending');
    });
    const expireReading = vi.fn(() => Promise.resolve());

    await env.execute(documentReading, {
      workflowsPath,
      activities: { settleReading, expireReading },
      args: [input],
    });

    expect(expireReading).toHaveBeenCalledTimes(1);
    expect(settleReading).toHaveBeenCalledTimes(READING_TIMEOUT_MS / READING_PULL_INTERVAL_MS + 1);
    // Only the first settling waits on the transaction that started the workflow.
    expect(settled[0]?.transactionId).toBe('123456');
    expect(settled.slice(1).every((ref) => ref.transactionId === null)).toBe(true);
  });

  it('settles on the job event, and fails nothing', async () => {
    let ended = false;
    const settleReading = vi.fn((): Promise<ReadingOutcome> =>
      Promise.resolve(ended ? 'settled' : 'pending'),
    );
    const expireReading = vi.fn(() => Promise.resolve());

    await env.run(
      documentReading,
      { workflowsPath, activities: { settleReading, expireReading }, args: [input] },
      async (handle) => {
        await vi.waitFor(() => {
          expect(settleReading).toHaveBeenCalledTimes(1);
        });
        ended = true;
        await handle.signal(READING_JOB_FINISHED_SIGNAL);
        await handle.result();
      },
    );

    expect(settleReading).toHaveBeenCalledTimes(2);
    expect(expireReading).not.toHaveBeenCalled();
  });

  it('ends at once when the starting transaction rolled back (nothing waits)', async () => {
    const settleReading = vi.fn((): Promise<ReadingOutcome> => Promise.resolve('settled'));
    const expireReading = vi.fn(() => Promise.resolve());

    await env.execute(documentReading, {
      workflowsPath,
      activities: { settleReading, expireReading },
      args: [input],
    });

    expect(settleReading).toHaveBeenCalledTimes(1);
    expect(expireReading).not.toHaveBeenCalled();
  });
});
