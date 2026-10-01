import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ClosureWorkflows } from '../../src/closures/closure-workflows.js';
import {
  CLOSURE_SWEEPS_WORKFLOW,
  closureSweepScheduleId,
  closureSweepWorkflowId,
} from '../../src/closures/contract.js';
import { inClosureSample } from '../../src/closures/sampling.js';
import type { closureSweeps as closureSweepsWorkflow } from '../../src/closures/workflows.js';
import { config } from '../../src/config.js';
import {
  closureSweeps,
  determinations,
  outbox,
  reviewCases,
  reviewFlags,
  reviewTimeline,
} from '../../src/db/schema.js';
import { caseIds, givenQueuedCase, givenQueuedCases, temporalOf } from '../support/closures.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type ReviewApi, startReviewApi } from '../support/review-api.js';
import { historyPayloads } from '../support/workflow-history.js';

/**
 * S3 at the workflow seam: the daily closure sweep, as its Temporal schedule starts it, proposes
 * `compliant-no-issues` (proposer `system`) for the low-band cases whose window has passed with no
 * open flag (none, or all reviewed), no open clarification and no determination, held by a
 * reviewer or not; diverts the deterministic sample (2%) to review, leaves every other case
 * untouched (determined or kept for further action among them), and records the run with
 * `closure.sweep.completed.v1`; ids and counts only in Temporal's history. The sample re-enters
 * the reviewers' queue; the proposals stay out of the approvals inbox (they are approved in bulk).
 */
describe('closure sweep (S3)', () => {
  let api: ReviewApi;

  const reviewer: Caller = { sub: 'reviewer-a', tenant: 'psc', roles: ['reviewer'] };
  const supervisor: Caller = { sub: 'supervisor-s', tenant: 'psc', roles: ['supervisor'] };
  /** The day after the 2027 cases' window closed, 09:00 in Nairobi. */
  const SWEEP_DAY = '2028-07-01T06:00:00.000Z';

  beforeAll(async () => {
    api = await startReviewApi();
    return () => api.close();
  });

  beforeEach(async () => {
    await api.reset();
    api.directory.givenCommission('psc');
    api.directory.givenCommission('tsc');
    api.clock.set(SWEEP_DAY);
  });

  /** Runs the day's sweep as the schedule would: `closureSweeps` on the service's worker. */
  async function runSweeps(): Promise<{ swept: number }> {
    return temporalOf(api).workflow.execute<typeof closureSweepsWorkflow>(CLOSURE_SWEEPS_WORKFLOW, {
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: `closure-sweeps-test-${randomUUID()}`,
      args: [],
    });
  }

  const outboxOf = async (type: string) =>
    (await api.asPlatform((tx) => tx.select().from(outbox)))
      .filter((event) => event.envelope.type === type)
      .map((event) => event.envelope);

  it('S3: proposes the eligible, diverts the 2% sample to review, leaves the ineligible', async () => {
    const eligible = await givenQueuedCases(api, 'psc', caseIds(12, { sampled: false }));
    const sampled = await givenQueuedCases(api, 'psc', caseIds(2, { sampled: true }));
    const openFlag = await givenQueuedCase(api, 'psc', { openFlags: 1 });
    const openClarification = await givenQueuedCase(api, 'psc', { openClarifications: 1 });
    const medium = await givenQueuedCase(api, 'psc', { band: 'medium' });
    const windowOpen = await givenQueuedCase(api, 'psc', {
      windowEndsAt: new Date('2028-08-01T00:00:00.000Z'),
    });
    // Held by a reviewer who reviewed every flag: eligible all the same.
    const held = await givenQueuedCase(api, 'psc', { status: 'assigned', assignee: 'reviewer-a' });
    await api.asPlatform((tx) =>
      tx.insert(reviewFlags).values({
        id: randomUUID(),
        tenant: 'psc',
        caseId: held,
        versionId: randomUUID(),
        ruleId: 'no-previous-version',
        severity: 'info',
        title: 'No previous version',
        indicator: 'First declaration on Adili',
        evidence: {},
        itemRefs: [],
        reviewedAt: new Date('2028-01-10T08:00:00.000Z'),
        reviewedBy: 'reviewer-a',
        reviewNote: 'First declaration: nothing to compare.',
      }),
    );
    const determined = await givenQueuedCase(api, 'psc', { status: 'determined' });
    const furtherAction = await givenQueuedCase(api, 'psc', { status: 'further-action' });
    const tscCase = await givenQueuedCase(api, 'tsc');
    const ineligible = [openFlag, openClarification, medium, windowOpen, determined, furtherAction];

    expect(await runSweeps()).toEqual({ swept: 2 });

    // Eligible: one system proposal each, `compliant-no-issues`, waiting for approval.
    const proposals = await api.asPlatform((tx) => tx.select().from(determinations));
    expect(proposals.map((row) => row.caseId).sort()).toEqual([...eligible, held, tscCase].sort());
    for (const proposal of proposals) {
      expect(proposal).toMatchObject({
        outcome: 'compliant-no-issues',
        proposerKind: 'system',
        proposer: null,
        status: 'proposed',
        proposedAt: new Date(SWEEP_DAY),
        reference: null,
      });
    }

    // The sample: back in the queue as `sample-review`, marked, with a timeline entry.
    const cases = await api.asPlatform((tx) => tx.select().from(reviewCases));
    const byId = new Map(cases.map((row) => [row.id, row]));
    for (const id of sampled) {
      expect(inClosureSample(id, 2027, 0.02)).toBe(true);
      expect(byId.get(id)).toMatchObject({
        status: 'sample-review',
        sampledAt: new Date(SWEEP_DAY),
        assignee: null,
      });
    }
    const timeline = await api.asPlatform((tx) =>
      tx.select().from(reviewTimeline).where(inArray(reviewTimeline.caseId, sampled)),
    );
    expect(timeline.filter((entry) => entry.kind === 'sampled-for-review')).toHaveLength(2);
    const queue = await api.get('/v1/commissions/psc/review/queue?status=sample-review', reviewer);
    expect(queue.statusCode).toBe(200);
    expect(
      queue
        .json<{ items: { id: string }[] }>()
        .items.map((item) => item.id)
        .sort(),
    ).toEqual([...sampled].sort());

    // The ineligible: untouched.
    for (const id of ineligible) {
      expect(byId.get(id)?.sampledAt).toBeNull();
      expect(proposals.some((row) => row.caseId === id)).toBe(false);
    }
    // The held case keeps its reviewer and status while its closure waits for approval.
    expect(byId.get(held)).toMatchObject({ status: 'assigned', assignee: 'reviewer-a' });

    // The runs, recorded with their counts, and announced.
    const sweeps = await api.asPlatform((tx) => tx.select().from(closureSweeps));
    expect(
      sweeps.map(({ tenant, cycleYear, proposed, sampled: count, sampleRate, ranAt }) => ({
        tenant,
        cycleYear,
        proposed,
        sampled: count,
        sampleRate,
        ranAt,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          tenant: 'psc',
          cycleYear: 2027,
          proposed: 13,
          sampled: 2,
          sampleRate: 0.02,
          ranAt: new Date(SWEEP_DAY),
        },
        {
          tenant: 'tsc',
          cycleYear: 2027,
          proposed: 1,
          sampled: 0,
          sampleRate: 0.02,
          ranAt: new Date(SWEEP_DAY),
        },
      ]),
    );
    const pscSweep = sweeps.find((sweep) => sweep.tenant === 'psc');
    expect(await outboxOf('closure.sweep.completed.v1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant: 'psc',
          subject: pscSweep?.id,
          data: {
            sweepId: pscSweep?.id,
            cycleYear: 2027,
            proposed: 13,
            sampled: 2,
            sampleRate: 0.02,
          },
        }),
      ]),
    );
    const proposed = await outboxOf('determination.proposed.v1');
    expect(proposed).toHaveLength(14);
    expect(proposed[0]?.data).toEqual({
      determinationId: expect.any(String) as string,
      caseId: expect.any(String) as string,
      outcome: 'compliant-no-issues',
      proposerKind: 'system',
      approver: null,
    });

    // Temporal's history of the day's sweep of psc holds ids and counts, nothing personal.
    const history = await historyPayloads(
      temporalOf(api),
      closureSweepWorkflowId({ tenant: 'psc', cycleYear: 2027 }, '2028-07-01'),
    );
    expect(history).toContain('psc');
    expect(history).not.toMatch(/Wanjiru|Kamau|DCB-|PSC\/|no issues|No issues/);

    // The proposals are approved in bulk, not through the inbox.
    const inbox = await api.get('/v1/commissions/psc/approvals', supervisor);
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json<{ items: unknown[] }>().items).toEqual([]);
  });

  it('S3: the sample is deterministic and a later sweep changes nothing twice', async () => {
    const ids = await givenQueuedCases(api, 'psc', [
      ...caseIds(3, { sampled: true }),
      ...caseIds(5, { sampled: false }),
    ]);
    await runSweeps();
    const first = await api.asPlatform((tx) =>
      tx.select({ id: reviewCases.id, status: reviewCases.status }).from(reviewCases),
    );

    // The next day: nothing is eligible any more, so no run for the cycle.
    api.clock.set('2028-07-02T06:00:00.000Z');
    expect(await runSweeps()).toEqual({ swept: 0 });
    const second = await api.asPlatform((tx) =>
      tx.select({ id: reviewCases.id, status: reviewCases.status }).from(reviewCases),
    );
    expect(second.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      first.sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(await api.asPlatform((tx) => tx.select().from(determinations))).toHaveLength(5);

    // Whether a case is sampled depends on it and the cycle only.
    for (const { id, status } of second) {
      expect(status === 'sample-review').toBe(inClosureSample(id, 2027, 0.02));
    }
    expect(ids).toHaveLength(8);
  });

  it('S3: before the window closes nothing is swept', async () => {
    await givenQueuedCases(api, 'psc', caseIds(4, { sampled: false }));
    api.clock.set('2028-06-01T06:00:00.000Z');

    expect(await runSweeps()).toEqual({ swept: 0 });

    expect(await api.asPlatform((tx) => tx.select().from(determinations))).toEqual([]);
    const unassigned = await api.asPlatform((tx) =>
      tx
        .select()
        .from(reviewCases)
        .where(and(eq(reviewCases.tenant, 'psc'), eq(reviewCases.status, 'unassigned'))),
    );
    expect(unassigned).toHaveLength(4);
  });

  it('keeps a daily Temporal schedule that starts the sweep', async () => {
    const scheduleId = await api.app.get(ClosureWorkflows).ensureSchedule('0 2 * * *');
    const handle = temporalOf(api).schedule.getHandle(scheduleId);
    try {
      expect(scheduleId).toBe(closureSweepScheduleId(config.TEMPORAL_TASK_QUEUE));
      const described = await handle.describe();
      expect(described.action).toMatchObject({
        type: 'startWorkflow',
        workflowType: CLOSURE_SWEEPS_WORKFLOW,
        taskQueue: config.TEMPORAL_TASK_QUEUE,
      });
      expect(described.spec.timezone).toBe('Africa/Nairobi');

      // Kept again on the next start: the existing schedule is updated, not duplicated.
      await api.app.get(ClosureWorkflows).ensureSchedule('0 3 * * *');
      expect((await handle.describe()).spec.calendars?.[0]?.hour).toEqual([
        { start: 3, end: 3, step: 1 },
      ]);
    } finally {
      await handle.delete();
    }
  });

  it('the summary counts the sweep for supervisors', async () => {
    await givenQueuedCases(api, 'psc', [
      ...caseIds(2, { sampled: true }),
      ...caseIds(6, { sampled: false }),
    ]);
    const before = await api.get('/v1/commissions/psc/closures?cycleYear=2027', supervisor);
    expect(before.statusCode, before.body).toBe(200);
    expect(before.json()).toEqual({
      cycleYear: 2027,
      eligibleProposed: 0,
      sampled: 0,
      approved: 0,
      sampleRate: 0.02,
      windowClosedAt: '2028-06-10T09:00:00.000Z',
      lastSweptAt: null,
    });

    await runSweeps();

    const after = await api.get('/v1/commissions/psc/closures?cycleYear=2027', supervisor);
    expect(
      contractErrors(okResponse('/v1/commissions/{slug}/closures', 'get'), after.json()),
    ).toEqual([]);
    expect(after.json()).toMatchObject({
      eligibleProposed: 6,
      sampled: 2,
      approved: 0,
      lastSweptAt: SWEEP_DAY,
    });
    const initial = await api.get(
      '/v1/commissions/psc/closures?cycleYear=2027&type=initial',
      supervisor,
    );
    expect(initial.json()).toMatchObject({ eligibleProposed: 0, sampled: 0 });
  });
});
