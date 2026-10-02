import { fileURLToPath } from 'node:url';

import { FieldCipherError } from '@adili/data-access';
import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { ApplicationFailure } from '@temporalio/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AiGatewayUnavailable } from '../../src/ai-gateway/ai-gateway-client.js';
import type { CopilotActivities } from '../../src/copilot/activities.js';
import {
  COPILOT_POLICY_PAGE,
  COPILOT_POLICY_PAGES_PER_RUN,
  copilotJobFinished,
  copilotPolicyChanged,
} from '../../src/copilot/workflows.js';

/** `copilotJobFinished` and `copilotPolicyChanged` against mocked activities in Temporal's time-skipping test environment. */
const workflowsPath = fileURLToPath(new URL('../../src/processing/workflows.ts', import.meta.url));

type Activities = { [K in keyof CopilotActivities]: CopilotActivities[K] };

const job = {
  tenant: 'psc',
  caseId: '0199b000-0000-7000-8000-0000000000c1',
  jobId: '0199b000-0000-7000-8000-0000000000a1',
};

function activities(overrides: Partial<Activities> = {}): Activities {
  return {
    requestCopilot: vi.fn(() => Promise.resolve()),
    settleCopilot: vi.fn(() => Promise.resolve()),
    recordCopilotJob: vi.fn(() => Promise.resolve()),
    copilotUnavailable: vi.fn(() => Promise.resolve()),
    notEnabledCopilots: vi.fn(() => Promise.resolve({ caseIds: [], next: null })),
    ...overrides,
  };
}

describe('copilotJobFinished', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  it("records the job's outcome", async () => {
    const mocks = activities();
    await env.execute(copilotJobFinished, { workflowsPath, activities: mocks, args: [job] });
    expect(mocks.recordCopilotJob).toHaveBeenCalledWith(job);
    expect(mocks.copilotUnavailable).not.toHaveBeenCalled();
  }, 60_000);

  it('retries a gateway outage with backoff, then records the copilot as failed for that job', async () => {
    const mocks = activities({
      recordCopilotJob: vi.fn(() =>
        Promise.reject(new AiGatewayUnavailable('ai-gateway unreachable')),
      ),
    });
    await env.execute(copilotJobFinished, { workflowsPath, activities: mocks, args: [job] });
    expect(mocks.recordCopilotJob).toHaveBeenCalledTimes(10);
    expect(mocks.copilotUnavailable).toHaveBeenCalledWith({
      ...job,
      reason: 'ai-gateway-unavailable',
    });
  }, 60_000);

  it('records what stayed unavailable: the key service, or an error of its own, not the gateway', async () => {
    for (const [error, reason] of [
      [new FieldCipherError('unavailable', 'OpenBao is sealed'), 'key-service-unavailable'],
      // Another cipher failure, as the activities rethrow it (Q23).
      [
        ApplicationFailure.nonRetryable('Tampered', 'FieldCipherError:decryption-failed'),
        'internal-error',
      ],
      [new TypeError('a bug'), 'internal-error'],
    ] as const) {
      const mocks = activities({ recordCopilotJob: vi.fn(() => Promise.reject(error)) });
      await env.execute(copilotJobFinished, { workflowsPath, activities: mocks, args: [job] });
      expect(mocks.copilotUnavailable).toHaveBeenCalledWith({ ...job, reason });
    }
  }, 120_000);
});

describe('copilotPolicyChanged', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  it('requests every not-enabled copilot of the Commission again, and a failed one is recorded as unavailable', async () => {
    const cases = ['0199b000-0000-7000-8000-0000000000c1', '0199b000-0000-7000-8000-0000000000c2'];
    const mocks = activities({
      notEnabledCopilots: vi.fn(() => Promise.resolve({ caseIds: cases, next: null })),
      requestCopilot: vi.fn((request: { caseId: string }) =>
        request.caseId === cases[1]
          ? Promise.reject(new AiGatewayUnavailable('ai-gateway unreachable'))
          : Promise.resolve(),
      ),
    });
    await env.execute(copilotPolicyChanged, {
      workflowsPath,
      activities: mocks,
      args: [{ tenant: 'psc' }],
    });
    expect(mocks.notEnabledCopilots).toHaveBeenCalledWith({
      tenant: 'psc',
      after: null,
      limit: COPILOT_POLICY_PAGE,
    });
    expect(mocks.requestCopilot).toHaveBeenCalledWith({
      tenant: 'psc',
      caseId: cases[0],
      trigger: 'policy-change',
    });
    expect(mocks.copilotUnavailable).toHaveBeenCalledWith({
      tenant: 'psc',
      caseId: cases[1],
      reason: 'ai-gateway-unavailable',
    });
  }, 120_000);

  it("pulls the request's jobs in an activity of its own: an outage there never asks the gateway again", async () => {
    const caseId = '0199b000-0000-7000-8000-0000000000c1';
    const mocks = activities({
      notEnabledCopilots: vi.fn(() => Promise.resolve({ caseIds: [caseId], next: null })),
      settleCopilot: vi.fn(() =>
        Promise.reject(new AiGatewayUnavailable('ai-gateway unreachable')),
      ),
    });
    await env.execute(copilotPolicyChanged, {
      workflowsPath,
      activities: mocks,
      args: [{ tenant: 'psc' }],
    });
    expect(mocks.requestCopilot).toHaveBeenCalledTimes(1);
    expect(mocks.settleCopilot).toHaveBeenCalledWith({ tenant: 'psc', caseId });
    // The jobs were asked for; their events record them.
    expect(mocks.copilotUnavailable).not.toHaveBeenCalled();
  }, 120_000);

  it('pages through the not-enabled copilots and continues as new, so a large Commission fits in history', async () => {
    const total = COPILOT_POLICY_PAGE * COPILOT_POLICY_PAGES_PER_RUN + 3;
    const cases = Array.from(
      { length: total },
      (_, i) => `0199b000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    );
    const pages: (string | null)[] = [];
    const mocks = activities({
      notEnabledCopilots: vi.fn(
        ({ after, limit }: { tenant: string; after: string | null; limit: number }) => {
          pages.push(after);
          const start = after === null ? 0 : cases.indexOf(after) + 1;
          const caseIds = cases.slice(start, start + limit);
          const next = start + limit < cases.length ? (caseIds.at(-1) ?? null) : null;
          return Promise.resolve({ caseIds, next });
        },
      ),
    });
    const runIds = await env.run(
      copilotPolicyChanged,
      { workflowsPath, activities: mocks, args: [{ tenant: 'psc' }] },
      async (handle) => {
        await handle.result();
        return { first: handle.firstExecutionRunId, last: (await handle.describe()).runId };
      },
    );
    expect(mocks.requestCopilot).toHaveBeenCalledTimes(total);
    // Every case once, none twice across pages or runs (N16).
    const requested = vi.mocked(mocks.requestCopilot).mock.calls.map(([request]) => request.caseId);
    expect(requested).toEqual(cases);
    expect(pages).toHaveLength(COPILOT_POLICY_PAGES_PER_RUN + 1);
    // The last run is a continuation of the first.
    expect(runIds.last).not.toBe(runIds.first);
  }, 120_000);
});
