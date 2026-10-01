import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { ApplicationFailure } from '@temporalio/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RegistryCheckActivities } from '../../src/registry/activities.js';
import {
  REGISTRY_SWEEP_BATCH,
  type LookupRequest,
  type MatchRequest,
  type RegistryCheckRequest,
  type RegistryCheckResult,
  type RegistryLookups,
} from '../../src/registry/contract.js';
import { registrySweep } from '../../src/registry/workflows.js';

/**
 * `RegistryUnavailableSweep` against mocked activities in Temporal's time-skipping test
 * environment (S10): the cases with a registry still unavailable, oldest first, each checked as
 * a `registryCheck` child, spaced out, and one failing check never stopping the run.
 */
const workflowsPath = fileURLToPath(new URL('../../src/processing/workflows.ts', import.meta.url));

type Activities = { [K in keyof RegistryCheckActivities]: RegistryCheckActivities[K] };

const caseRequest = (n: number): RegistryCheckRequest => ({
  tenant: n % 2 === 0 ? 'psc' : 'tsc',
  caseId: `0199b000-0000-7000-8000-0000000000c${String(n)}`,
  declarationId: `0199b000-0000-7000-8000-0000000000d${String(n)}`,
  versionId: `0199b000-0000-7000-8000-0000000000e${String(n)}`,
  version: 1,
});

/** Every registry answered: the recovered ArdhiSasa among them. */
const answered: RegistryLookups = {
  persons: {
    officer: {
      ardhisasa: {
        outcome: 'found',
        reason: null,
        resultId: 'r-ardhisasa',
        checkedAt: '2027-12-10T10:00:00.000Z',
      },
    },
  },
  suppliers: {},
};

const checked: RegistryCheckResult = {
  outcome: 'checked',
  flags: 1,
  statuses: [{ personKey: 'officer', system: 'ardhisasa', status: 'mismatched', reason: null }],
};

describe('RegistryUnavailableSweep', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  it('S10: checks each case with a registry unavailable as a child, oldest first, spaced out', async () => {
    const candidates = [caseRequest(1), caseRequest(2), caseRequest(3)];
    const matchedAt: number[] = [];
    const matchRegistries = vi.fn<(request: MatchRequest) => Promise<RegistryCheckResult>>(
      async () => {
        matchedAt.push(await env.env.currentTimeMs());
        return checked;
      },
    );
    const mocks: Activities = {
      registrySweepCandidates: vi.fn(() => Promise.resolve(candidates)),
      lookupRegistries: vi.fn(() => Promise.resolve<RegistryLookups | null>(answered)),
      matchRegistries,
    };

    const result = await env.execute(registrySweep, { workflowsPath, activities: mocks, args: [] });

    expect(result).toEqual({ checked: 3, stale: 0, failed: 0 });
    expect(mocks.registrySweepCandidates).toHaveBeenCalledWith({ limit: REGISTRY_SWEEP_BATCH });
    expect(matchRegistries.mock.calls.map(([call]) => call.check)).toEqual(candidates);
    // Ten seconds between cases, so a registry that just came back is not flooded.
    const gaps = matchedAt.slice(1).map((time, index) => time - (matchedAt[index] ?? 0));
    expect(gaps.every((gap) => gap >= 10_000)).toBe(true);
  }, 60_000);

  it('a check that fails for good is counted and the run goes on; a stale case is counted apart', async () => {
    const candidates = [caseRequest(1), caseRequest(2), caseRequest(3)];
    const mocks: Activities = {
      registrySweepCandidates: vi.fn(() => Promise.resolve(candidates)),
      lookupRegistries: vi.fn(({ check }: LookupRequest) =>
        Promise.resolve<RegistryLookups | null>(
          check.caseId === candidates[2]?.caseId ? null : answered,
        ),
      ),
      matchRegistries: vi.fn(({ check }: MatchRequest) =>
        check.caseId === candidates[0]?.caseId
          ? Promise.reject(ApplicationFailure.nonRetryable('gone', 'version-missing'))
          : Promise.resolve(checked),
      ),
    };

    const result = await env.execute(registrySweep, { workflowsPath, activities: mocks, args: [] });

    expect(result).toEqual({ checked: 1, stale: 1, failed: 1 });
  }, 60_000);

  it('does nothing when no case has a registry unavailable', async () => {
    const mocks: Activities = {
      registrySweepCandidates: vi.fn(() => Promise.resolve([])),
      lookupRegistries: vi.fn(() => Promise.resolve<RegistryLookups | null>(answered)),
      matchRegistries: vi.fn(() => Promise.resolve(checked)),
    };

    const result = await env.execute(registrySweep, { workflowsPath, activities: mocks, args: [] });

    expect(result).toEqual({ checked: 0, stale: 0, failed: 0 });
    expect(mocks.lookupRegistries).not.toHaveBeenCalled();
  }, 60_000);
});
