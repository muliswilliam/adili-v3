import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { Context } from '@temporalio/activity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CycleOpeningActivities } from '../../src/obligations/workflow/cycle-opening-activities.js';
import {
  CYCLE_OPENING_PAGES_PER_RUN,
  type CycleOpened,
  type CycleOpeningPage,
  type CycleOpeningPageRequest,
} from '../../src/obligations/workflow/contract.js';
import { cycleOpening } from '../../src/obligations/workflow/workflows.js';

/**
 * S13 (workflow): `CycleOpeningWorkflow` against mocked activities in Temporal's time-skipping
 * test environment: it opens each cycle due for the tenant page by page, records each cycle
 * opened once its last page is done, and continues as new every 100 pages.
 */
const workflowsPath = fileURLToPath(
  new URL('../../src/obligations/workflow/workflows.ts', import.meta.url),
);

type Activities = { [K in keyof CycleOpeningActivities]: CycleOpeningActivities[K] };

/** A tenant whose active snapshots come in `pages` pages per cycle, `perPage` created each. */
class FakeTenant {
  readonly pageCalls: (CycleOpeningPageRequest & { runId: string })[] = [];
  readonly opened: (CycleOpened & { tenant: string })[] = [];

  constructor(
    private readonly due: number[],
    private readonly pages: number,
    private readonly perPage = 3,
  ) {}

  activities(): Activities {
    return {
      cyclesToOpen: () => Promise.resolve([...this.due]),
      openCyclePage: (request: CycleOpeningPageRequest): Promise<CycleOpeningPage> => {
        this.pageCalls.push({
          ...request,
          runId: Context.current().info.workflowExecution?.runId ?? '',
        });
        const index = request.cursor === null ? 0 : Number(request.cursor);
        const next = index + 1;
        return Promise.resolve({
          created: this.perPage,
          nextCursor: next < this.pages ? String(next) : null,
        });
      },
      recordCycleOpened: (tenant: string, cycleYear: number) => {
        // As the database would count them: every page's creates for the cycle.
        const created = this.pageCalls.filter((call) => call.cycleYear === cycleYear).length;
        const cycle = { cycleYear, count: created * this.perPage };
        this.opened.push({ tenant, ...cycle });
        return Promise.resolve(cycle);
      },
    };
  }
}

describe('S13 CycleOpeningWorkflow', () => {
  let env: WorkflowTestEnvironment;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 60_000);

  afterAll(async () => {
    await env.teardown();
  });

  it('pages through the cycle due and records it opened with the obligations created', async () => {
    const tenant = new FakeTenant([2027], 3);

    const opened = await env.execute(cycleOpening, {
      workflowsPath,
      activities: tenant.activities(),
      args: [{ tenant: 'psc' }],
    });

    expect(tenant.pageCalls.map(({ cycleYear, cursor }) => [cycleYear, cursor])).toEqual([
      [2027, null],
      [2027, '1'],
      [2027, '2'],
    ]);
    expect(tenant.pageCalls.every((call) => call.tenant === 'psc')).toBe(true);
    expect(tenant.opened).toEqual([{ tenant: 'psc', cycleYear: 2027, count: 9 }]);
    expect(opened).toEqual([{ cycleYear: 2027, count: 9 }]);
  });

  it('does nothing when no cycle is due for the tenant (a second firing)', async () => {
    const tenant = new FakeTenant([], 3);

    const opened = await env.execute(cycleOpening, {
      workflowsPath,
      activities: tenant.activities(),
      args: [{ tenant: 'psc' }],
    });

    expect(tenant.pageCalls).toEqual([]);
    expect(tenant.opened).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('opens each cycle due in turn, counting each on its own', async () => {
    const tenant = new FakeTenant([2027, 2029], 2);

    await env.execute(cycleOpening, {
      workflowsPath,
      activities: tenant.activities(),
      args: [{ tenant: 'psc' }],
    });

    expect(tenant.pageCalls.map(({ cycleYear, cursor }) => [cycleYear, cursor])).toEqual([
      [2027, null],
      [2027, '1'],
      [2029, null],
      [2029, '1'],
    ]);
    expect(tenant.opened).toEqual([
      { tenant: 'psc', cycleYear: 2027, count: 6 },
      { tenant: 'psc', cycleYear: 2029, count: 6 },
    ]);
  });

  it('continues as new every 100 pages, carrying the cursor', async () => {
    const pages = CYCLE_OPENING_PAGES_PER_RUN * 2 + 50;
    const tenant = new FakeTenant([2027], pages, 1);

    await env.execute(cycleOpening, {
      workflowsPath,
      activities: tenant.activities(),
      args: [{ tenant: 'psc' }],
    });

    expect(tenant.pageCalls).toHaveLength(pages);
    expect(tenant.pageCalls.map((call) => call.cursor)).toEqual(
      Array.from({ length: pages }, (_, index) => (index === 0 ? null : String(index))),
    );
    const runs = [...new Set(tenant.pageCalls.map((call) => call.runId))];
    expect(runs).toHaveLength(3);
    const pagesPerRun = runs.map(
      (runId) => tenant.pageCalls.filter((call) => call.runId === runId).length,
    );
    expect(pagesPerRun).toEqual([CYCLE_OPENING_PAGES_PER_RUN, CYCLE_OPENING_PAGES_PER_RUN, 50]);
    expect(tenant.opened).toEqual([{ tenant: 'psc', cycleYear: 2027, count: pages }]);
  }, 60_000);
});
