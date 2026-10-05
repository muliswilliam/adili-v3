import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CopilotActivityRequest } from '../../src/copilot/contract.js';
import type {
  RegistryCheckRequest,
  RegistryCheckResult,
  RegistryLookups,
  SweepCheck,
} from '../../src/registry/contract.js';
import { registryRecheck, registrySweep } from '../../src/registry/workflows.js';

/**
 * `registryRecheck` (#603) against mocked activities in Temporal's time-skipping test
 * environment: a re-check refreshes the case's copilot with the check's time (spec 07c S11),
 * always when a reviewer asked for it, and from the sweep only when a status changed.
 */
const workflowsPath = fileURLToPath(new URL('../../src/processing/workflows.ts', import.meta.url));

const request: RegistryCheckRequest = {
  tenant: 'psc',
  caseId: '0199b000-0000-7000-8000-0000000000c1',
  declarationId: '0199b000-0000-7000-8000-000000000001',
  versionId: '0199b000-0000-7000-8000-000000000002',
  version: 1,
};

const answered: RegistryLookups = {
  sequence: 2,
  persons: {
    officer: {
      kra: { outcome: 'found', reason: null, resultId: 'r-kra', checkedAt: '2027-12-10T10:00:00Z' },
    },
  },
  suppliers: {},
};

const checked = (changed: boolean): RegistryCheckResult => ({
  outcome: 'checked',
  flags: 0,
  statuses: [{ personKey: 'officer', system: 'kra', status: 'matched', reason: null }],
  checkedAt: '2027-12-10T10:00:01.000Z',
  changed,
});

function activities(result: RegistryCheckResult) {
  const copilot: CopilotActivityRequest[] = [];
  return {
    copilot,
    mocks: {
      lookupRegistries: vi.fn(() => Promise.resolve(answered)),
      matchAndStoreRegistries: vi.fn(() => Promise.resolve(result)),
      requestCopilot: vi.fn((asked: CopilotActivityRequest) => {
        copilot.push(asked);
        return Promise.resolve();
      }),
      settleCopilot: vi.fn(() => Promise.resolve()),
      copilotUnavailable: vi.fn(() => Promise.resolve()),
      planRegistrySweep: vi.fn(() => Promise.resolve<SweepCheck[]>([{ request, startAfterMs: 0 }])),
    },
  };
}

describe('registryRecheck', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  it("S11: a reviewer's re-check refreshes the copilot with the check's time", async () => {
    const { copilot, mocks } = activities(checked(false));
    const result = await env.execute(registryRecheck, {
      workflowsPath,
      activities: mocks,
      args: [request, { refreshCopilot: 'always' }],
    });
    expect(result).toMatchObject({ outcome: 'checked' });
    expect(copilot).toEqual([
      {
        tenant: 'psc',
        caseId: request.caseId,
        trigger: 're-check',
        registryCheckedAt: '2027-12-10T10:00:01.000Z',
      },
    ]);
  }, 60_000);

  it('a stale check asks nothing of the copilot', async () => {
    const { copilot, mocks } = activities({ outcome: 'stale' });
    await env.execute(registryRecheck, {
      workflowsPath,
      activities: mocks,
      args: [request, { refreshCopilot: 'always' }],
    });
    expect(copilot).toEqual([]);
  }, 60_000);

  it('only when a status changed: refreshes on a change, not otherwise', async () => {
    const unchanged = activities(checked(false));
    await env.execute(registryRecheck, {
      workflowsPath,
      activities: unchanged.mocks,
      args: [request, { refreshCopilot: 'if-changed' }],
    });
    expect(unchanged.copilot).toEqual([]);

    const changed = activities(checked(true));
    await env.execute(registryRecheck, {
      workflowsPath,
      activities: changed.mocks,
      args: [request, { refreshCopilot: 'if-changed' }],
    });
    expect(changed.copilot).toHaveLength(1);
  }, 60_000);

  it('S10: the sweep refreshes the copilot of a case whose statuses changed, and only then', async () => {
    const changed = activities(checked(true));
    expect(
      await env.execute(registrySweep, { workflowsPath, activities: changed.mocks, args: [] }),
    ).toEqual({ checked: 1, stale: 0, failed: 0 });
    expect(changed.copilot.map((asked) => asked.trigger)).toEqual(['re-check']);

    const same = activities(checked(false));
    await env.execute(registrySweep, { workflowsPath, activities: same.mocks, args: [] });
    expect(same.copilot).toEqual([]);
  }, 60_000);
});
