import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { TEMPORAL_CLIENT } from '@adili/temporal';
import type { Client } from '@temporalio/client';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { filingObligations } from '../../src/db/schema.js';
import type { Transaction } from '../../src/db/transaction.js';
import { addDays, nairobiDate } from '../../src/obligations/dates.js';
import { DECLARANT_ONBOARDED, ROSTER_IMPORT_COMPLETED } from '../../src/obligations/events.js';
import { cancelSignal, stateQuery } from '../../src/obligations/workflow/contract.js';
import { ObligationWorkflows } from '../../src/obligations/workflows.js';
import {
  type DeclarationsApi,
  directoryEvent,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { policyVersion, rosterRecord } from '../support/fake-directory.js';

/**
 * S24: an import event published to RabbitMQ ends in a running `FilingObligationWorkflow` on the
 * compose Temporal: the service's consumer (on the suite's own queue) ingests it, and the
 * service's own worker (the suite's task queue) runs the workflow with its real activities
 * against the test database. Time cannot be skipped on a real server, so the workflow is
 * described, its history read for the pending timer, and queried for its next step.
 *
 * Real time throughout: the declarant was appointed two days ago under a policy starting this
 * year, so the initial is due, its 30-day reminder was past at creation and the 14-day one is
 * next.
 */
let api: DeclarationsApi;
let temporal: Client;
const started: string[] = [];

beforeAll(async () => {
  api = await startDeclarationsApi({ workflows: 'real', events: true });
  temporal = api.app.get<Client>(TEMPORAL_CLIENT);
  return async () => {
    await Promise.all(
      started.map((id) =>
        temporal.workflow
          .getHandle(id)
          .terminate('test over')
          .catch(() => undefined),
      ),
    );
    await api.close();
  };
}, 60_000);

function asPlatform<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(api.db, { tenant: 'platform', subject: 'test' }, work);
}

/** The workflow's timers started and neither fired nor cancelled, with when each fires. */
async function pendingTimers(id: string): Promise<{ firesAt: Date }[]> {
  const events = (await temporal.workflow.getHandle(id).fetchHistory()).events ?? [];
  const done = new Set(
    events.flatMap((event) => {
      const ended = event.timerFiredEventAttributes ?? event.timerCanceledEventAttributes;
      return ended?.timerId ? [ended.timerId] : [];
    }),
  );
  return events.flatMap((event) => {
    const started = event.timerStartedEventAttributes;
    if (!started?.timerId || done.has(started.timerId)) return [];
    const at = Number(event.eventTime?.seconds ?? 0) * 1000;
    const timeout = Number(started.startToFireTimeout?.seconds ?? 0) * 1000;
    return [{ firesAt: new Date(at + timeout) }];
  });
}

async function obligationOf(rosterRecordId: string) {
  const [obligation] = await asPlatform((tx) =>
    tx
      .select({
        id: filingObligations.id,
        workflowStartedAt: filingObligations.workflowStartedAt,
      })
      .from(filingObligations)
      .where(eq(filingObligations.rosterRecordId, rosterRecordId)),
  );
  return obligation;
}

describe('S24 FilingObligationWorkflow on Temporal', () => {
  it('starts the workflow of an obligation imported through RabbitMQ, which waits on a timer for its next reminder; personLinked reaches it', async () => {
    const today = nairobiDate(new Date());
    const appointed = addDays(today, -2);
    api.directory.givenCommission(
      'psc',
      'Public Service Commission',
      policyVersion({ obligationsStartDate: `${today.slice(0, 4)}-01-01` }),
    );
    const record = rosterRecord('psc', { appointmentDate: appointed });
    const importId = randomUUID();
    api.directory.givenImport(importId, [record]);

    await api.publish(
      directoryEvent(ROSTER_IMPORT_COMPLETED, 'psc', { importId, channel: 'file' }),
    );

    await vi.waitFor(
      async () => {
        expect((await obligationOf(record.id))?.workflowStartedAt).toBeInstanceOf(Date);
      },
      { timeout: 30_000, interval: 250 },
    );
    const id = (await obligationOf(record.id))?.id ?? '';
    started.push(id);

    const handle = temporal.workflow.getHandle(id);
    const description = await handle.describe();
    expect(description).toMatchObject({
      type: 'filingObligation',
      taskQueue: process.env.TEMPORAL_TASK_QUEUE,
      status: { name: 'RUNNING' },
    });
    await vi.waitFor(
      async () => {
        expect(await handle.query(stateQuery)).toMatchObject({
          obligationId: id,
          status: 'due',
          statementDate: appointed,
          dueDate: addDays(appointed, 30),
          personLinked: false,
          remindersRecorded: [30],
          next: { kind: 'reminder', offsetDays: 14 },
        });
      },
      { timeout: 30_000, interval: 250 },
    );
    // One timer pending, for the 14-day reminder: midday in Nairobi, jittered by at most 6 hours.
    const timers = await pendingTimers(id);
    expect(timers).toHaveLength(1);
    expect(nairobiDate(timers[0]?.firesAt ?? new Date(0))).toBe(addDays(appointed, 30 - 14));

    api.directory.givenRecords([
      {
        ...record,
        personId: '7d3f9b2a-4c1e-4a8b-9f60-2e5d8c1b0a47',
        ofr: 'OFR-0000417-4',
        state: 'onboarded',
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      },
    ]);
    await api.publish(directoryEvent(DECLARANT_ONBOARDED, 'psc', { rosterRecordId: record.id }));

    await vi.waitFor(
      async () => {
        expect(await handle.query(stateQuery)).toMatchObject({ personLinked: true });
      },
      { timeout: 30_000, interval: 250 },
    );
  }, 60_000);

  it('the sweep starts again the workflow of an open obligation whose run was terminated; a completed one is never run again', async () => {
    const today = nairobiDate(new Date());
    api.directory.givenCommission(
      'psc',
      'Public Service Commission',
      policyVersion({ obligationsStartDate: `${today.slice(0, 4)}-01-01` }),
    );
    const record = rosterRecord('psc', { appointmentDate: addDays(today, -2) });
    const importId = randomUUID();
    api.directory.givenImport(importId, [record]);
    await api.publish(
      directoryEvent(ROSTER_IMPORT_COMPLETED, 'psc', { importId, channel: 'file' }),
    );
    await vi.waitFor(
      async () => {
        expect((await obligationOf(record.id))?.workflowStartedAt).toBeInstanceOf(Date);
      },
      { timeout: 30_000, interval: 250 },
    );
    const id = (await obligationOf(record.id))?.id ?? '';
    started.push(id);
    const handle = temporal.workflow.getHandle(id);
    const { runId: terminatedRun } = await handle.describe();

    await handle.terminate('operator mistake');

    // Visibility lists the terminated run within seconds; a sweep after that starts a new run.
    await vi.waitFor(
      async () => {
        await api.sweep.run({ graceMs: 0 });
        const now = await handle.describe();
        expect(now.runId).not.toBe(terminatedRun);
        expect(now.status.name).toBe('RUNNING');
      },
      { timeout: 30_000, interval: 1_000 },
    );

    // The new run completes (a cancel signal ends it; the row is left open on purpose).
    await handle.signal(cancelSignal, 'superseded');
    await expect(temporal.workflow.getHandle(id).result()).resolves.toBe('cancelled');
    const { runId: completedRun } = await handle.describe();

    // Neither a start nor the sweep runs a completed workflow again.
    await api.app.get(ObligationWorkflows).apply('psc', {
      created: [id],
      cancelled: [],
      personLinked: [],
      filed: [],
    });
    await api.sweep.run({ graceMs: 0 });
    const after = await handle.describe();
    expect(after.runId).toBe(completedRun);
    expect(after.status.name).toBe('COMPLETED');
  }, 60_000);
});
