import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RegistryCheckActivities } from '../../src/registry/activities.js';
import type {
  LookupOutcome,
  LookupRequest,
  RegistryCheckRequest,
  RegistryCheckResult,
  RegistryLookups,
} from '../../src/registry/contract.js';
import { registryCheck } from '../../src/registry/workflows.js';

/**
 * `RegistryCheckWorkflow` against mocked activities in Temporal's time-skipping test environment
 * (S9): the lookups, looked up again with backoff while a registry gives no answer, then the
 * matching, which a registry still unavailable after three retries never stops.
 */
const workflowsPath = fileURLToPath(new URL('../../src/processing/workflows.ts', import.meta.url));

type CheckActivities = Pick<
  RegistryCheckActivities,
  'lookupRegistries' | 'matchAndStoreRegistries'
>;
type Activities = { [K in keyof CheckActivities]: CheckActivities[K] };

const request: RegistryCheckRequest = {
  tenant: 'psc',
  caseId: '0199b000-0000-7000-8000-0000000000c1',
  declarationId: '0199b000-0000-7000-8000-000000000001',
  versionId: '0199b000-0000-7000-8000-000000000002',
  version: 1,
};

const found = (resultId: string): LookupOutcome => ({
  outcome: 'found',
  reason: null,
  resultId,
  checkedAt: '2027-12-10T09:00:00.000Z',
});
const timedOut = (resultId: string): LookupOutcome => ({
  outcome: 'unavailable',
  reason: 'timeout',
  resultId,
  checkedAt: '2027-12-10T09:00:00.000Z',
});

/** The officer's lookups with ArdhiSasa answered as given. */
const officer = (ardhisasa: LookupOutcome, suppliers: RegistryLookups['suppliers'] = {}) => ({
  sequence: 1,
  persons: {
    officer: { kra: found('r-kra'), ntsa: found('r-ntsa'), brs: found('r-brs'), ardhisasa },
  },
  suppliers,
});

const checked: RegistryCheckResult = {
  outcome: 'checked',
  flags: 2,
  statuses: [
    { personKey: 'officer', system: 'ardhisasa', status: 'unavailable', reason: 'timeout' },
  ],
  checkedAt: '2027-12-10T10:00:01.000Z',
  changed: false,
};

describe('RegistryCheckWorkflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  /** Lookups answering `answers` in turn (the last one again), with when each was made. */
  function lookupsAnswering(...answers: (RegistryLookups | null)[]) {
    const at: number[] = [];
    const lookupRegistries = vi.fn<(request: LookupRequest) => Promise<RegistryLookups | null>>(
      async () => {
        at.push(await env.env.currentTimeMs());
        return answers[Math.min(at.length - 1, answers.length - 1)] ?? null;
      },
    );
    return { lookupRegistries, at };
  }

  it('S9: a registry unavailable after three retries with backoff stays unavailable, and matching goes on', async () => {
    const { lookupRegistries, at } = lookupsAnswering(
      officer(timedOut('r-1')),
      officer(timedOut('r-2')),
      officer(timedOut('r-3')),
      officer(timedOut('r-4')),
    );
    const mocks: Activities = {
      lookupRegistries,
      matchAndStoreRegistries: vi.fn(() => Promise.resolve(checked)),
    };

    const result = await env.execute(registryCheck, {
      workflowsPath,
      activities: mocks,
      args: [request],
    });

    expect(result).toEqual(checked);
    // The first attempt and three retries, each given the attempt before.
    expect(lookupRegistries.mock.calls.map(([call]) => call.previous)).toEqual([
      null,
      officer(timedOut('r-1')),
      officer(timedOut('r-2')),
      officer(timedOut('r-3')),
    ]);
    expect(
      lookupRegistries.mock.calls.every(([call]) => call.check.caseId === request.caseId),
    ).toBe(true);
    // Backoff: 5, 10 and 20 seconds.
    const waits = at.slice(1).map((time, index) => time - (at[index] ?? 0));
    expect(waits[0]).toBeGreaterThanOrEqual(5_000);
    expect(waits[1]).toBeGreaterThanOrEqual(10_000);
    expect(waits[2]).toBeGreaterThanOrEqual(20_000);
    expect(mocks.matchAndStoreRegistries).toHaveBeenCalledWith({
      check: request,
      lookups: officer(timedOut('r-4')),
    });
  }, 60_000);

  it('looks up again only until every registry and supplier check answered', async () => {
    const unavailableSupplier = {
      'PVT-9XYZ2L4Q': { ...timedOut('r-s1'), supplies: null },
    };
    const answeredSupplier = { 'PVT-9XYZ2L4Q': { ...found('r-s2'), supplies: true } };
    const { lookupRegistries } = lookupsAnswering(
      officer(timedOut('r-1')),
      officer(found('r-2'), unavailableSupplier),
      officer(found('r-2'), answeredSupplier),
    );
    const mocks: Activities = {
      lookupRegistries,
      matchAndStoreRegistries: vi.fn(() => Promise.resolve(checked)),
    };

    await env.execute(registryCheck, { workflowsPath, activities: mocks, args: [request] });

    expect(lookupRegistries).toHaveBeenCalledTimes(3);
    expect(mocks.matchAndStoreRegistries).toHaveBeenCalledWith({
      check: request,
      lookups: officer(found('r-2'), answeredSupplier),
    });
  }, 60_000);

  it('does not look up again what the gateway refused: it needs fixing, not waiting', async () => {
    const refused: LookupOutcome = {
      outcome: 'unavailable',
      reason: 'gateway-rejected',
      resultId: null,
      checkedAt: null,
    };
    const { lookupRegistries } = lookupsAnswering(officer(refused));
    const mocks: Activities = {
      lookupRegistries,
      matchAndStoreRegistries: vi.fn(() => Promise.resolve(checked)),
    };

    await env.execute(registryCheck, { workflowsPath, activities: mocks, args: [request] });

    expect(lookupRegistries).toHaveBeenCalledTimes(1);
    expect(mocks.matchAndStoreRegistries).toHaveBeenCalledWith({
      check: request,
      lookups: officer(refused),
    });
  }, 60_000);

  it('matches at once when every registry answered the first time', async () => {
    const { lookupRegistries } = lookupsAnswering(officer(found('r-1')));
    const mocks: Activities = {
      lookupRegistries,
      matchAndStoreRegistries: vi.fn(() => Promise.resolve(checked)),
    };

    await env.execute(registryCheck, { workflowsPath, activities: mocks, args: [request] });

    expect(lookupRegistries).toHaveBeenCalledTimes(1);
    expect(mocks.matchAndStoreRegistries).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('is stale, matching nothing, when the case moved on to a later version', async () => {
    const mocks: Activities = {
      lookupRegistries: vi.fn(() => Promise.resolve(null)),
      matchAndStoreRegistries: vi.fn(() => Promise.resolve(checked)),
    };

    const result = await env.execute(registryCheck, {
      workflowsPath,
      activities: mocks,
      args: [request],
    });

    expect(result).toEqual({ outcome: 'stale' });
    expect(mocks.matchAndStoreRegistries).not.toHaveBeenCalled();
  }, 60_000);
});
