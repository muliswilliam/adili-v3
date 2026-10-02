import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CopilotActivities } from '../../src/copilot/activities.js';
import { copilotJobFinished, copilotPolicyChanged } from '../../src/copilot/workflows.js';

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
    recordCopilotJob: vi.fn(() => Promise.resolve()),
    copilotUnavailable: vi.fn(() => Promise.resolve()),
    notEnabledCopilots: vi.fn(() => Promise.resolve([])),
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
      recordCopilotJob: vi.fn(() => Promise.reject(new Error('ai-gateway unreachable'))),
    });
    await env.execute(copilotJobFinished, { workflowsPath, activities: mocks, args: [job] });
    expect(mocks.recordCopilotJob).toHaveBeenCalledTimes(10);
    expect(mocks.copilotUnavailable).toHaveBeenCalledWith(job);
  }, 60_000);
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
      notEnabledCopilots: vi.fn(() => Promise.resolve(cases)),
      requestCopilot: vi.fn((request: { caseId: string }) =>
        request.caseId === cases[1]
          ? Promise.reject(new Error('ai-gateway unreachable'))
          : Promise.resolve(),
      ),
    });
    await env.execute(copilotPolicyChanged, {
      workflowsPath,
      activities: mocks,
      args: [{ tenant: 'psc' }],
    });
    expect(mocks.notEnabledCopilots).toHaveBeenCalledWith({ tenant: 'psc' });
    expect(mocks.requestCopilot).toHaveBeenCalledWith({
      tenant: 'psc',
      caseId: cases[0],
      trigger: 'policy-change',
    });
    expect(mocks.copilotUnavailable).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: 'psc', caseId: cases[1] }),
    );
  }, 120_000);
});
