import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { ApplicationFailure } from '@temporalio/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RegistryCheckActivities } from '../../src/registry/activities.js';
import {
  type LookupRequest,
  type MatchRequest,
  type RegistryCheckRequest,
  type RegistryCheckResult,
  type RegistryLookups,
  SWEEP_CONCURRENCY,
  type SweepCheck,
} from '../../src/registry/contract.js';
import { registrySweep } from '../../src/registry/workflows.js';

/**
 * `registrySweep` (the spec's RegistryUnavailableSweep) against mocked activities in Temporal's
 * time-skipping test environment (S10): the planned cases, oldest first, each checked as a
 * `registryCheck` child no earlier than its plan says and a few at once, and one failing check
 * never stopping the run.
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
  sequence: 1,
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

/** A plan starting the cases at once, as when every system has room for all of them. */
const atOnce = (requests: RegistryCheckRequest[]): SweepCheck[] =>
  requests.map((request) => ({ request, startAfterMs: 0 }));

describe('registrySweep', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  it('S10: checks each planned case as a child, oldest first, none before its start', async () => {
    const plan: SweepCheck[] = [
      { request: caseRequest(1), startAfterMs: 0 },
      { request: caseRequest(2), startAfterMs: 0 },
      { request: caseRequest(3), startAfterMs: 8 * 60_000 },
    ];
    const lookedUpAt = new Map<string, number>();
    let started = 0;
    const mocks: Activities = {
      planRegistrySweep: vi.fn(async () => {
        started = await env.env.currentTimeMs();
        return plan;
      }),
      lookupRegistries: vi.fn(async ({ check }: LookupRequest) => {
        lookedUpAt.set(check.caseId, (await env.env.currentTimeMs()) - started);
        return answered;
      }),
      matchAndStoreRegistries: vi.fn(() => Promise.resolve(checked)),
    };

    const result = await env.execute(registrySweep, { workflowsPath, activities: mocks, args: [] });

    expect(result).toEqual({ checked: 3, stale: 0, failed: 0 });
    expect([...lookedUpAt.keys()]).toEqual(plan.map((entry) => entry.request.caseId));
    // The third waits for its share of the rate limits: eight minutes into the run.
    expect(lookedUpAt.get(caseRequest(3).caseId)).toBeGreaterThanOrEqual(8 * 60_000);
    expect(lookedUpAt.get(caseRequest(2).caseId)).toBeLessThan(60_000);
  }, 60_000);

  it(`has at most ${String(SWEEP_CONCURRENCY)} checks going at once`, async () => {
    const plan = atOnce(Array.from({ length: 10 }, (_, n) => caseRequest(n + 1)));
    let going = 0;
    let most = 0;
    const mocks: Activities = {
      planRegistrySweep: vi.fn(() => Promise.resolve(plan)),
      lookupRegistries: vi.fn(async () => {
        going += 1;
        most = Math.max(most, going);
        // Each check takes a while: the time-skipping server moves the clock on.
        await new Promise((resolve) => setTimeout(resolve, 50));
        going -= 1;
        return answered;
      }),
      matchAndStoreRegistries: vi.fn(() => Promise.resolve(checked)),
    };

    const result = await env.execute(registrySweep, { workflowsPath, activities: mocks, args: [] });

    expect(result).toEqual({ checked: 10, stale: 0, failed: 0 });
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(SWEEP_CONCURRENCY);
  }, 60_000);

  it('a check that fails for good is counted and the run goes on; a stale case is counted apart', async () => {
    const candidates = [caseRequest(1), caseRequest(2), caseRequest(3)];
    const mocks: Activities = {
      planRegistrySweep: vi.fn(() => Promise.resolve(atOnce(candidates))),
      lookupRegistries: vi.fn(({ check }: LookupRequest) =>
        Promise.resolve<RegistryLookups | null>(
          check.caseId === candidates[2]?.caseId ? null : answered,
        ),
      ),
      matchAndStoreRegistries: vi.fn(({ check }: MatchRequest) =>
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
      planRegistrySweep: vi.fn(() => Promise.resolve([])),
      lookupRegistries: vi.fn(() => Promise.resolve<RegistryLookups | null>(answered)),
      matchAndStoreRegistries: vi.fn(() => Promise.resolve(checked)),
    };

    const result = await env.execute(registrySweep, { workflowsPath, activities: mocks, args: [] });

    expect(result).toEqual({ checked: 0, stale: 0, failed: 0 });
    expect(mocks.lookupRegistries).not.toHaveBeenCalled();
  }, 60_000);
});
