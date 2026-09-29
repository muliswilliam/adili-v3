import { fileURLToPath } from 'node:url';

import { WorkflowTestEnvironment } from '@adili/temporal/testing';
import { Context } from '@temporalio/activity';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHASE_INTERVAL_MS,
  type ChaseOutcome,
  type ChaseRequest,
  chaseRoundAt,
  type ChaseWorkflowInput,
  firstChaseAt,
  NCR_APPROVED_SIGNAL,
} from '../../src/compliance-reports/contract.js';
import type { NationalChaseActivities } from '../../src/compliance-reports/national-chase-activities.js';
import {
  nationalChaseStart,
  nationalConsolidation,
} from '../../src/compliance-reports/workflows.js';
import { financialYearAt } from '../../src/financial-year.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * S10 at the workflow seam: `NationalConsolidationWorkflow` against mocked activities in
 * Temporal's time-skipping test environment. From 1 August it chases the Commissions without a
 * submitted report weekly, drops a Commission once it submits, and ends when every Commission has
 * reported or the national consolidated report is approved. History holds the year, rounds,
 * slugs and counts only.
 */
const workflowsPath = fileURLToPath(
  new URL('../../src/compliance-reports/workflows.ts', import.meta.url),
);

type Activities = { [K in keyof NationalChaseActivities]: NationalChaseActivities[K] };

describe('NationalConsolidationWorkflow', () => {
  let env: WorkflowTestEnvironment;
  /** The financial year whose first chase (1 August) is still ahead of the test server's clock. */
  let fy: number;

  beforeAll(async () => {
    env = await WorkflowTestEnvironment.create();
  }, 120_000);

  // Each test skips the test server's clock forward by months: a fresh server each.
  beforeEach(async () => {
    await env.teardown();
    env = await WorkflowTestEnvironment.create();
    const now = await env.env.currentTimeMs();
    const current = financialYearAt(new Date(now));
    fy = firstChaseAt(current - 1) > now ? current - 1 : current;
  }, 120_000);

  afterAll(async () => {
    await env.teardown();
  });

  /**
   * Activities over Commissions that have not reported: `outstanding(round)` answers the round's
   * targets. Chases record the round and the (skipped) time they ran at.
   */
  function activities(options: {
    outstanding: (round: number) => string[];
    onChase?: (request: ChaseRequest) => Promise<void>;
  }): { mocks: Activities; chased: (ChaseRequest & { at: number })[] } {
    const chased: (ChaseRequest & { at: number })[] = [];
    let rounds = 0;
    const mocks: Activities = {
      chaseTargets: vi.fn(() => {
        rounds += 1;
        return Promise.resolve({ tenants: options.outstanding(rounds) });
      }),
      chaseCommission: vi.fn(async (request: ChaseRequest): Promise<ChaseOutcome> => {
        chased.push({ ...request, at: Context.current().info.scheduledTimestampMs });
        await options.onChase?.(request);
        return { outcome: 'chased', recipients: 2 };
      }),
      startNationalChase: vi.fn(() => Promise.resolve({ fy: 2027, started: true })),
    };
    return { mocks, chased };
  }

  const run = (mocks: Activities, input: ChaseWorkflowInput = { fy }) =>
    env.execute(nationalConsolidation, { workflowsPath, activities: mocks, args: [input] });

  const signalOwnWorkflow = (signal: string) => {
    const { workflowExecution } = Context.current().info;
    if (!workflowExecution) throw new Error('Not an activity of a workflow');
    return env.env.client.workflow.getHandle(workflowExecution.workflowId).signal(signal);
  };

  it('S10: from 1 August chases the Commissions that have not reported, weekly, until every one has', async () => {
    // jsc and tsc have not reported; tsc submits in the first week, jsc in the second.
    const { mocks, chased } = activities({
      outstanding: (round) => [['jsc', 'tsc'], ['jsc'], []][round - 1] ?? [],
    });

    const result = await run(mocks);

    expect(result).toEqual({ rounds: 2, chases: 3, ended: 'all-reported' });
    expect(chased.map(({ tenant, round }) => [tenant, round])).toEqual([
      ['jsc', 1],
      ['tsc', 1],
      ['jsc', 2],
    ]);
    const first = firstChaseAt(fy);
    for (const { round, at } of chased) {
      const due = first + (round - 1) * CHASE_INTERVAL_MS;
      expect(at).toBeGreaterThanOrEqual(due);
      expect(at).toBeLessThan(due + 60_000);
    }
    expect(mocks.chaseTargets).toHaveBeenCalledTimes(3);
    expect(mocks.chaseCommission).toHaveBeenCalledWith({ fy, tenant: 'jsc', round: 1 });
  }, 60_000);

  it('S10: the first chase is 1 August at 09:00 in Nairobi, and rounds count the weeks from it', () => {
    expect(new Date(firstChaseAt(2027)).toISOString()).toBe('2028-08-01T06:00:00.000Z');
    expect(chaseRoundAt(2027, firstChaseAt(2027))).toBe(1);
    expect(chaseRoundAt(2027, firstChaseAt(2027) + CHASE_INTERVAL_MS - 1)).toBe(1);
    expect(chaseRoundAt(2027, firstChaseAt(2027) + CHASE_INTERVAL_MS)).toBe(2);
  });

  it('S10: ends without a chase when every Commission reported by 1 August', async () => {
    const { mocks, chased } = activities({ outstanding: () => [] });

    const result = await run(mocks);

    expect(result).toEqual({ rounds: 0, chases: 0, ended: 'all-reported' });
    expect(chased).toEqual([]);
  }, 60_000);

  it('S10: ends when the national consolidated report is approved', async () => {
    const { mocks, chased } = activities({
      outstanding: () => ['jsc'],
      onChase: async ({ round }) => {
        if (round === 2) await signalOwnWorkflow(NCR_APPROVED_SIGNAL);
      },
    });

    const result = await run(mocks);

    expect(result).toEqual({ rounds: 2, chases: 2, ended: 'ncr-approved' });
    expect(chased.map(({ round }) => round)).toEqual([1, 2]);
  }, 60_000);

  it('S10: started after 1 August, chases at once and weekly from then', async () => {
    // Last year's first chase is behind the test server's clock.
    const late = fy - 1;
    const started = await env.env.currentTimeMs();
    const { mocks, chased } = activities({
      outstanding: (round) => (round <= 2 ? ['jsc'] : []),
    });

    const result = await run(mocks, { fy: late });

    expect(result).toEqual({ rounds: 2, chases: 2, ended: 'all-reported' });
    const [first, second] = chased;
    expect(first?.at).toBeLessThan(started + 60_000);
    // A week after the round began (its first activity is scheduled moments later).
    const apart = (second?.at ?? 0) - (first?.at ?? 0);
    expect(apart).toBeGreaterThan(CHASE_INTERVAL_MS - 60_000);
    expect(apart).toBeLessThan(CHASE_INTERVAL_MS + 60_000);
    expect(second?.round).toBe((first?.round ?? 0) + 1);
  }, 60_000);

  it('S10: continued in a fresh history, carries on from the round due with its counts', async () => {
    const nextAt = firstChaseAt(fy) + 3 * CHASE_INTERVAL_MS;
    const { mocks, chased } = activities({ outstanding: (round) => (round === 1 ? ['jsc'] : []) });

    const result = await run(mocks, { fy, rounds: 3, chases: 4, nextAt });

    expect(result).toEqual({ rounds: 4, chases: 5, ended: 'all-reported' });
    expect(chased.map(({ round }) => round)).toEqual([4]);
    expect(chased[0]?.at).toBeGreaterThanOrEqual(nextAt);
  }, 60_000);

  it('S10: history holds the year, rounds, slugs and counts only', async () => {
    let workflowId = '';
    const { mocks } = activities({
      outstanding: (round) => (round === 1 ? ['jsc'] : []),
      onChase: () => {
        workflowId = Context.current().info.workflowExecution?.workflowId ?? '';
        return Promise.resolve();
      },
    });

    await run(mocks);

    const payloads = await historyPayloads(env.env.client, workflowId);
    expect(payloads).toContain('"tenant":"jsc"');
    expect(payloads).not.toMatch(/@|Commission|officer/i);
  }, 60_000);

  it('the yearly start begins the chase of the year whose reports were due on 31 July', async () => {
    const { mocks } = activities({ outstanding: () => [] });

    const result = await env.execute(nationalChaseStart, {
      workflowsPath,
      activities: mocks,
      args: [],
    });

    expect(result).toEqual({ fy: 2027, started: true });
    expect(mocks.startNationalChase).toHaveBeenCalledOnce();
  }, 60_000);
});
