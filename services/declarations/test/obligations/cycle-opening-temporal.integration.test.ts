import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { TEMPORAL_CLIENT } from '@adili/temporal';
import type { Client, ScheduleHandle } from '@temporalio/client';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { filingObligations, outbox } from '../../src/db/schema.js';
import type { Transaction } from '../../src/obligations/apply-page.js';
import { ROSTER_IMPORT_COMPLETED } from '../../src/obligations/events.js';
import { cycleOpeningScheduleId } from '../../src/obligations/workflow/cycle-opening-schedules.js';
import {
  type DeclarationsApi,
  directoryEvent,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { rosterRecord } from '../support/fake-directory.js';

/**
 * S13 on the compose Temporal: the first import creates PSC's cycle-opening schedule (fired at
 * once, and daily after); a firing on or after the opening date runs `CycleOpeningWorkflow` on
 * the service's worker (the suite's task queue), and a second firing creates nothing new. The
 * schedule is fired by hand here; the service's clock is pinned.
 */
let api: DeclarationsApi;
let temporal: Client;
let schedule: ScheduleHandle;

beforeAll(async () => {
  api = await startDeclarationsApi({ workflows: 'real' });
  temporal = api.app.get<Client>(TEMPORAL_CLIENT);
  schedule = temporal.schedule.getHandle(
    cycleOpeningScheduleId(process.env.TEMPORAL_TASK_QUEUE ?? '', 'psc'),
  );
}, 60_000);

afterAll(async () => {
  const ids = await asPlatform((tx) =>
    tx.select({ id: filingObligations.id }).from(filingObligations),
  );
  await Promise.all(
    ids.map(({ id }) =>
      temporal.workflow
        .getHandle(id)
        .terminate('test over')
        .catch(() => undefined),
    ),
  );
  await api.close();
});

function asPlatform<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(api.db, { tenant: 'platform', subject: 'test' }, work);
}

/** Waits for the schedule's `n`th run (1-based) to be started, and for it to finish. */
async function runOfSchedule(n: number): Promise<unknown> {
  let workflowId = '';
  await vi.waitFor(
    async () => {
      const { info } = await schedule.describe();
      expect(info.recentActions.length).toBeGreaterThanOrEqual(n);
      workflowId = info.recentActions[n - 1]?.action.workflow.workflowId ?? '';
    },
    { timeout: 20_000, interval: 250 },
  );
  return temporal.workflow.getHandle(workflowId).result();
}

async function biennials() {
  return asPlatform((tx) =>
    tx
      .select({ id: filingObligations.id, workflowStartedAt: filingObligations.workflowStartedAt })
      .from(filingObligations)
      .where(and(eq(filingObligations.tenant, 'psc'), eq(filingObligations.type, 'biennial'))),
  );
}

describe('S13 cycle opening on Temporal', () => {
  it('creates the schedule on first import; a firing opens the cycle once', async () => {
    api.clock.setToday('2027-06-01');
    api.directory.givenCommission('psc', 'Public Service Commission');
    const importId = randomUUID();
    api.directory.givenImport(importId, [
      rosterRecord('psc'),
      rosterRecord('psc'),
      rosterRecord('psc', { state: 'exited', exitDate: '2027-05-15' }),
    ]);
    await api.consumers.importCompleted(
      directoryEvent(ROSTER_IMPORT_COMPLETED, 'psc', { importId, channel: 'file' }),
    );

    // Created on the import and fired at once: before the opening date, nothing to open.
    expect(await runOfSchedule(1)).toEqual([]);
    const { spec, action } = await schedule.describe();
    expect(action).toMatchObject({
      type: 'startWorkflow',
      workflowType: 'cycleOpening',
      taskQueue: process.env.TEMPORAL_TASK_QUEUE,
      args: [{ tenant: 'psc' }],
    });
    expect(spec.timezone).toBe('Africa/Nairobi');
    expect(await biennials()).toEqual([]);

    api.clock.setToday('2027-07-04');
    await schedule.trigger();
    expect(await runOfSchedule(2)).toEqual([{ cycleYear: 2027, count: 2 }]);
    const created = await biennials();
    expect(created).toHaveLength(2);
    expect(created.every((o) => o.workflowStartedAt instanceof Date)).toBe(true);

    await schedule.trigger();
    expect(await runOfSchedule(3)).toEqual([]);
    expect(await biennials()).toHaveLength(2);
    const events = await api.db
      .select({ id: outbox.id })
      .from(outbox)
      .where(eq(outbox.eventType, 'obligation.cycle-opened.v1'));
    expect(events).toHaveLength(1);
  }, 60_000);
});
