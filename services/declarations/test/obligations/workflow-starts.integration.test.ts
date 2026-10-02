import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { eq, isNull } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { filingObligations, rosterSnapshots } from '../../src/db/schema.js';
import type { Transaction } from '../../src/db/transaction.js';
import { DECLARANT_ONBOARDED, ROSTER_IMPORT_COMPLETED } from '../../src/obligations/events.js';
import { noChanges, ObligationWorkflows } from '../../src/obligations/workflows.js';
import {
  type DeclarationsApi,
  directoryEvent,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';

/**
 * Workflow starts and signals after commit, and the reconciliation sweep that heals lost starts
 * and stopped runs: the real `TemporalObligationWorkflows` against a fake Temporal client, real
 * Postgres.
 *
 * Today is 2027-07-10 (the 2027 cycle is open): each declarant owes the 2027 biennial, and those
 * appointed on 2027-07-01 an initial too.
 */
const TODAY = '2027-07-10';
const PERSON = '7d3f9b2a-4c1e-4a8b-9f60-2e5d8c1b0a47';

let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi({ workflows: 'fake' });
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  api.clock.setToday(TODAY);
  api.directory.givenCommission('psc', 'Public Service Commission');
});

function asPlatform<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(api.db, { tenant: 'platform', subject: 'test' }, work);
}

async function importRecords(records: ReturnType<typeof rosterRecord>[]) {
  const importId = randomUUID();
  api.directory.givenImport(importId, records);
  await api.consumers.importCompleted(
    directoryEvent(ROSTER_IMPORT_COMPLETED, 'psc', { importId, channel: 'file' }),
  );
}

async function obligations() {
  return asPlatform((tx) =>
    tx
      .select({
        id: filingObligations.id,
        type: filingObligations.type,
        status: filingObligations.status,
        workflowStartedAt: filingObligations.workflowStartedAt,
      })
      .from(filingObligations),
  );
}

async function unstarted() {
  return asPlatform((tx) =>
    tx
      .select({ id: filingObligations.id })
      .from(filingObligations)
      .where(isNull(filingObligations.workflowStartedAt)),
  );
}

describe('workflow starts after commit', () => {
  it('starts one FilingObligationWorkflow per created obligation, by obligation id, and marks it started', async () => {
    await importRecords([
      rosterRecord('psc', { appointmentDate: '2027-07-01' }),
      rosterRecord('psc'),
    ]);

    const rows = await obligations();
    expect(rows).toHaveLength(3);
    expect(api.temporal.startedIds().sort()).toEqual(rows.map((row) => row.id).sort());
    expect(api.temporal.starts[0]).toMatchObject({
      workflowType: 'filingObligation',
      options: {
        taskQueue: process.env.TEMPORAL_TASK_QUEUE,
        args: [{ obligationId: api.temporal.starts[0]?.workflowId }],
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
      },
    });
    expect(rows.every((row) => row.workflowStartedAt instanceof Date)).toBe(true);
  });

  it('signals personLinked when the declarant onboards, and cancel with its reason when an obligation is superseded', async () => {
    const record = rosterRecord('psc', { appointmentDate: '2027-07-01' });
    await importRecords([record]);
    const before = await obligations();
    const initial = before.find((row) => row.type === 'initial')?.id;

    // The appointment date is corrected: the initial is superseded by a new one.
    await importRecords([{ ...record, appointmentDate: '2027-07-03' }]);
    api.directory.givenRecords([
      {
        ...record,
        appointmentDate: '2027-07-03',
        personId: PERSON,
        ofr: 'OFR-0000417-4',
        state: 'onboarded',
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      },
    ]);
    await api.consumers.declarantOnboarded(
      directoryEvent(DECLARANT_ONBOARDED, 'psc', { rosterRecordId: record.id }),
    );

    const after = await obligations();
    const open = after.filter((row) => row.status !== 'cancelled').map((row) => row.id);
    expect(api.temporal.signals).toEqual([
      { workflowId: initial, signal: 'cancel', args: ['superseded'] },
      ...open.map((workflowId) => ({ workflowId, signal: 'personLinked', args: [] })),
    ]);
    expect(api.temporal.startedIds()).toHaveLength(3);
  });

  it('keeps the page when Temporal is down; the sweep starts the missing workflows later, once', async () => {
    api.temporal.down = true;

    await importRecords([rosterRecord('psc'), rosterRecord('psc')]);

    expect(await unstarted()).toHaveLength(2);
    await expect(api.sweep.run({ graceMs: 0 })).rejects.toThrow('obligation workflow calls failed');
    expect(await unstarted()).toHaveLength(2);

    api.temporal.down = false;
    await expect(api.sweep.run({ graceMs: 0 })).resolves.toEqual({
      started: 2,
      restarted: 0,
      cancelled: 0,
    });
    expect(await unstarted()).toEqual([]);
    await expect(api.sweep.run({ graceMs: 0 })).resolves.toEqual({
      started: 0,
      restarted: 0,
      cancelled: 0,
    });
    expect(api.temporal.startedIds().sort()).toEqual(
      (await obligations()).map((row) => row.id).sort(),
    );
  });

  it('sweeps only open obligations past the grace period, and counts a completed workflow as started', async () => {
    await importRecords([rosterRecord('psc'), rosterRecord('psc'), rosterRecord('psc')]);
    const [, cancelled, completed] = await obligations();
    await asPlatform(async (tx) => {
      await tx.update(filingObligations).set({ workflowStartedAt: null });
      await tx
        .update(filingObligations)
        .set({ status: 'cancelled', cancelReason: 'exited-before-statement-date' })
        .where(eq(filingObligations.id, cancelled?.id ?? ''));
    });
    api.temporal.stop(completed?.id ?? '', 'Completed');

    // Just created: left to the start that follows the commit.
    await expect(api.sweep.run()).resolves.toEqual({ started: 0, restarted: 0, cancelled: 0 });

    await expect(api.sweep.run({ graceMs: 0 })).resolves.toEqual({
      started: 2,
      restarted: 0,
      cancelled: 0,
    });
    // The completed workflow is not run again: its start is refused as already started.
    expect(api.temporal.runsOf(completed?.id ?? '')).toEqual(['Completed']);
    expect(await unstarted()).toEqual([{ id: cancelled?.id }]);
  });

  it('starts again, once, the workflows of open obligations whose run failed, timed out or was terminated', async () => {
    await importRecords([
      rosterRecord('psc'),
      rosterRecord('psc'),
      rosterRecord('psc'),
      rosterRecord('psc'),
    ]);
    const [failed, timedOut, terminated, running] = await obligations();
    // Started 20 minutes ago; three runs stopped 10 minutes ago.
    await asPlatform((tx) =>
      tx.update(filingObligations).set({ workflowStartedAt: new Date(Date.now() - 20 * 60_000) }),
    );
    const earlier = new Date(Date.now() - 10 * 60_000);
    api.temporal.stop(failed?.id ?? '', 'Failed', earlier);
    api.temporal.stop(timedOut?.id ?? '', 'TimedOut', earlier);
    api.temporal.stop(terminated?.id ?? '', 'Terminated', earlier);
    const startsBefore = api.temporal.starts.length;

    await expect(api.sweep.run({ graceMs: 0 })).resolves.toEqual({
      started: 0,
      restarted: 3,
      cancelled: 0,
    });
    expect(api.temporal.runsOf(failed?.id ?? '')).toEqual(['Failed', 'Running']);
    expect(api.temporal.runsOf(timedOut?.id ?? '')).toEqual(['TimedOut', 'Running']);
    expect(api.temporal.runsOf(terminated?.id ?? '')).toEqual(['Terminated', 'Running']);
    expect(api.temporal.runsOf(running?.id ?? '')).toEqual(['Running']);

    // Started since those runs closed: the next sweep leaves them be.
    await expect(api.sweep.run({ graceMs: 0 })).resolves.toEqual({
      started: 0,
      restarted: 0,
      cancelled: 0,
    });
    expect(api.temporal.starts.length).toBe(startsBefore + 3);

    // The restarted run of one fails too: that one is started again.
    api.temporal.stop(failed?.id ?? '', 'Failed');
    await expect(api.sweep.run({ graceMs: 0 })).resolves.toEqual({
      started: 0,
      restarted: 1,
      cancelled: 0,
    });
    expect(api.temporal.runsOf(failed?.id ?? '')).toEqual(['Failed', 'Failed', 'Running']);
  });

  it('leaves a stopped run be once its obligation is no longer open', async () => {
    await importRecords([rosterRecord('psc')]);
    const [obligation] = await obligations();
    api.temporal.stop(obligation?.id ?? '', 'Terminated');
    await asPlatform((tx) =>
      tx
        .update(filingObligations)
        .set({ status: 'cancelled', cancelReason: 'exited-before-statement-date' }),
    );

    await expect(api.sweep.run({ graceMs: 0 })).resolves.toEqual({
      started: 0,
      restarted: 0,
      cancelled: 0,
    });
    expect(api.temporal.runsOf(obligation?.id ?? '')).toEqual(['Terminated']);
  });

  it("cancels an exited declarant's upcoming biennial the engine no longer owes, and signals its workflow", async () => {
    const leaving = rosterRecord('psc');
    const staying = rosterRecord('psc', { exitDate: '2027-12-15', state: 'exited' });
    await importRecords([leaving, staying]);
    // The exit reached the snapshot but its reconciliation was lost (a crash mid-way).
    await asPlatform((tx) =>
      tx
        .update(rosterSnapshots)
        .set({ state: 'exited', exitDate: '2027-09-01' })
        .where(eq(rosterSnapshots.rosterRecordId, leaving.id)),
    );
    const signalled = api.temporal.signals.length;

    await expect(api.sweep.run({ graceMs: 0 })).resolves.toEqual({
      started: 0,
      restarted: 0,
      cancelled: 1,
    });

    const rows = await asPlatform((tx) =>
      tx
        .select({
          rosterRecordId: filingObligations.rosterRecordId,
          id: filingObligations.id,
          type: filingObligations.type,
          status: filingObligations.status,
          cancelReason: filingObligations.cancelReason,
        })
        .from(filingObligations),
    );
    const biennialOf = (id: string) =>
      rows.find((row) => row.rosterRecordId === id && row.type === 'biennial');
    expect(biennialOf(leaving.id)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'exited-before-statement-date',
    });
    // Exits after the statement date keep the biennial; the sweep creates nothing (no final).
    expect(biennialOf(staying.id)).toMatchObject({ status: 'upcoming' });
    expect(rows.filter((row) => row.rosterRecordId === leaving.id)).toHaveLength(1);
    expect(api.temporal.signals.slice(signalled)).toEqual([
      {
        workflowId: biennialOf(leaving.id)?.id,
        signal: 'cancel',
        args: ['exited-before-statement-date'],
      },
    ]);
    await expect(api.sweep.run({ graceMs: 0 })).resolves.toEqual({
      started: 0,
      restarted: 0,
      cancelled: 0,
    });
  });
});

describe('the filed signal (spec 06)', () => {
  it('signals filed to the workflow of an obligation a submission filed, and drops it for one never started', async () => {
    await importRecords([rosterRecord('psc')]);
    const [obligation] = await obligations();
    if (!obligation) throw new Error('no obligation');
    const signalled = api.temporal.signals.length;

    await api.app.get(ObligationWorkflows).apply('psc', {
      ...noChanges(),
      filed: [obligation.id, randomUUID()],
    });

    expect(api.temporal.signals.slice(signalled)).toEqual([
      { workflowId: obligation.id, signal: 'filed', args: [] },
    ]);
  });
});
