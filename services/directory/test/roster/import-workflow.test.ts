import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { ApplicationFailure } from '@temporalio/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RosterImportActivities } from '../../src/roster/import/activities.js';
import type {
  ChunkCounts,
  ImportRef,
  ImportResult,
  StageResult,
} from '../../src/roster/import/workflow-contract.js';
import { CHUNKS_PER_RUN, rosterImport } from '../../src/roster/import/workflows.js';

/**
 * S14 (and the flag-absent step of S8/S9): `RosterImportWorkflow` orchestration against mocked activities in Temporal's
 * time-skipping test environment, so retry backoff costs nothing.
 */
const workflowsPath = fileURLToPath(
  new URL('../../src/roster/import/workflows.ts', import.meta.url),
);
const REF: ImportRef = { importId: '0199a000-0000-7000-8000-000000000001', tenant: 'psc' };
const APPLIED: ChunkCounts = { created: 1000, updated: 0, unchanged: 0, rejected: 0 };
const FLAGGED = 7;

type Activities = { [K in keyof RosterImportActivities]: RosterImportActivities[K] };

function activities(
  overrides: Partial<Activities> & { chunks?: number; declaredComplete?: boolean } = {},
) {
  const staged: StageResult = {
    outcome: 'staged',
    chunkCount: overrides.chunks ?? 3,
    declaredComplete: overrides.declaredComplete ?? true,
  };
  return {
    stage: vi.fn<Activities['stage']>(overrides.stage ?? (() => Promise.resolve(staged))),
    applyChunk: vi.fn<Activities['applyChunk']>(
      overrides.applyChunk ?? (() => Promise.resolve(APPLIED)),
    ),
    flagAbsent: vi.fn<Activities['flagAbsent']>(
      overrides.flagAbsent ?? (() => Promise.resolve(FLAGGED)),
    ),
    finalise: vi.fn<Activities['finalise']>(overrides.finalise ?? (() => Promise.resolve())),
  };
}

describe('RosterImportWorkflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  const run = (mocks: ReturnType<typeof activities>) =>
    env.execute(rosterImport, { workflowsPath, activities: mocks, args: [REF] });

  it('stages, applies 2,500 rows as three chunks in order, flags absent officers, then finalises once', async () => {
    const mocks = activities({ chunks: 3 });

    await expect(run(mocks)).resolves.toBe('completed');

    expect(mocks.stage).toHaveBeenCalledExactlyOnceWith(REF);
    expect(mocks.applyChunk.mock.calls).toEqual([
      [REF, 0],
      [REF, 1],
      [REF, 2],
    ]);
    expect(mocks.flagAbsent).toHaveBeenCalledExactlyOnceWith(REF);
    expect(mocks.flagAbsent.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(...mocks.applyChunk.mock.invocationCallOrder),
    );
    expect(mocks.finalise).toHaveBeenCalledExactlyOnceWith(REF, {
      state: 'completed',
      flaggedAbsent: FLAGGED,
    });
  }, 60_000);

  it('flags nobody for a partial import', async () => {
    const mocks = activities({ declaredComplete: false });

    await expect(run(mocks)).resolves.toBe('completed');

    expect(mocks.flagAbsent).not.toHaveBeenCalled();
    expect(mocks.finalise).toHaveBeenCalledExactlyOnceWith(REF, { state: 'completed' });
  }, 60_000);

  it('flags absent officers after a retry', async () => {
    let attempts = 0;
    const mocks = activities({
      flagAbsent: () =>
        ++attempts < 2 ? Promise.reject(new Error('database hiccup')) : Promise.resolve(FLAGGED),
    });

    await expect(run(mocks)).resolves.toBe('completed');

    expect(mocks.flagAbsent).toHaveBeenCalledTimes(2);
    expect(mocks.finalise).toHaveBeenCalledExactlyOnceWith(REF, {
      state: 'completed',
      flaggedAbsent: FLAGGED,
    });
  }, 60_000);

  it('fails the import when flagging absent officers exhausts its retries', async () => {
    const mocks = activities({ flagAbsent: () => Promise.reject(new Error('lock timeout')) });

    await expect(run(mocks)).resolves.toBe('failed');

    expect(mocks.flagAbsent).toHaveBeenCalledTimes(3);
    expect(mocks.finalise).toHaveBeenCalledExactlyOnceWith(REF, {
      state: 'failed',
      failure: { code: 'internal', detail: expect.any(String) as string },
    } satisfies ImportResult);
  }, 60_000);

  it('completes when a chunk fails twice and then succeeds', async () => {
    let attempts = 0;
    const mocks = activities({
      applyChunk: (_ref, chunk) => {
        if (chunk === 1 && ++attempts < 3) return Promise.reject(new Error('database hiccup'));
        return Promise.resolve(APPLIED);
      },
    });

    await expect(run(mocks)).resolves.toBe('completed');

    expect(mocks.applyChunk.mock.calls.map(([, chunk]) => chunk)).toEqual([0, 1, 1, 1, 2]);
    expect(mocks.finalise).toHaveBeenCalledExactlyOnceWith(REF, {
      state: 'completed',
      flaggedAbsent: FLAGGED,
    });
  }, 60_000);

  it('fails the import when a chunk exhausts its retries, applying no later chunk', async () => {
    const mocks = activities({
      applyChunk: (_ref, chunk) =>
        chunk === 1 ? Promise.reject(new Error('constraint violated')) : Promise.resolve(APPLIED),
    });

    await expect(run(mocks)).resolves.toBe('failed');

    // Chunk 0 stays applied (the import keeps its processed count); chunk 2 never runs.
    expect(mocks.applyChunk.mock.calls.map(([, chunk]) => chunk)).toEqual([0, 1, 1, 1]);
    expect(mocks.flagAbsent).not.toHaveBeenCalled();
    expect(mocks.finalise).toHaveBeenCalledExactlyOnceWith(REF, {
      state: 'failed',
      failure: { code: 'internal', detail: expect.any(String) as string },
    } satisfies ImportResult);
  }, 60_000);

  it('fails the import with the staging failure, applying nothing', async () => {
    const failure = { code: 'missing-columns', detail: 'The file has no national_id column.' };
    const mocks = activities({
      stage: () => Promise.resolve({ outcome: 'failed', failure } as StageResult),
    });

    await expect(run(mocks)).resolves.toBe('failed');

    expect(mocks.applyChunk).not.toHaveBeenCalled();
    expect(mocks.finalise).toHaveBeenCalledExactlyOnceWith(REF, { state: 'failed', failure });
  }, 60_000);

  it('fails with storage-error when the file stays unreadable after retries', async () => {
    const mocks = activities({
      stage: () =>
        Promise.reject(ApplicationFailure.retryable('documents unreachable', 'storage-error')),
    });

    await expect(run(mocks)).resolves.toBe('failed');

    expect(mocks.stage).toHaveBeenCalledTimes(3);
    expect(mocks.finalise).toHaveBeenCalledExactlyOnceWith(REF, {
      state: 'failed',
      failure: { code: 'storage-error', detail: expect.any(String) as string },
    } satisfies ImportResult);
  }, 60_000);

  it('does nothing for an import that has already ended', async () => {
    const mocks = activities({ stage: () => Promise.resolve({ outcome: 'ended' }) });

    await expect(run(mocks)).resolves.toBe('ended');

    expect(mocks.applyChunk).not.toHaveBeenCalled();
    expect(mocks.finalise).not.toHaveBeenCalled();
  }, 60_000);

  it('continues as new between runs of chunks without skipping or repeating one', async () => {
    const chunks = CHUNKS_PER_RUN + 2;
    const mocks = activities({ chunks });

    await expect(run(mocks)).resolves.toBe('completed');

    expect(mocks.stage).toHaveBeenCalledOnce();
    expect(mocks.applyChunk.mock.calls.map(([, chunk]) => chunk)).toEqual(
      Array.from({ length: chunks }, (_, index) => index),
    );
    // The staged plan survives continue-as-new: the complete import still flags, once.
    expect(mocks.flagAbsent).toHaveBeenCalledOnce();
    expect(mocks.finalise).toHaveBeenCalledOnce();
  }, 60_000);
});
